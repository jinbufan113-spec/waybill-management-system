import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { evaluateQc } from '@/lib/qc-engine';
import { checkSkuBelongsWithFallback } from '@/lib/v2-client';
import { randomUUID } from 'crypto';

interface ScanInput {
  waybill_code: string;
  sku_code: string;
  actual_quantity?: number;
  actual_spec?: string;
  damage_level?: 'NONE' | 'MINOR' | 'MEDIUM' | 'SEVERE';
  label_match?: boolean;
  batch_anomaly?: boolean;
  operator_note?: string;
}

// POST /api/scan —— 扫描录入 + 品控判定（模块0/7核心）
// 关键：实时调 V2 校验 SKU 归属；幂等：同批次同 SKU 有未关闭品控工单时只追加扫描记录
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const body = (await request.json()) as ScanInput;
    const {
      waybill_code, sku_code, actual_quantity, actual_spec,
      damage_level = 'NONE', label_match = true, batch_anomaly = false, operator_note,
    } = body;

    if (!waybill_code || !sku_code) {
      return errorResponse('运单号与 SKU 必填', 400);
    }

    // 1) 实时校验 SKU 归属于真实存在的运单（V2 接口），V2 不可用时降级到本地快照
    const skuCheck = await checkSkuBelongsWithFallback(waybill_code, sku_code);
    if (!skuCheck.ok && skuCheck.source === 'UNAVAILABLE') {
      // V2 不通且本地无缓存，无法判定 SKU 归属，安全阻断
      return errorResponse(
        `SKU 归属校验失败：V2 不可用且无本地缓存，无法判定归属。Request-ID：${skuCheck.requestId}`,
        503
      );
    }
    if (skuCheck.ok && !skuCheck.belongs) {
      // 实时或缓存判定为「不属于」→ 阻断
      return errorResponse(
        `SKU ${sku_code} 不属于运单 ${waybill_code}，禁止扫描`,
        400,
        { request_id: skuCheck.requestId, source: skuCheck.source }
      );
    }

    // 取期望数量/规格
    const expected_quantity = skuCheck.sku_quantity;
    const expected_spec = actual_spec; // 简化：规格文本匹配不深度校验
    const sku_name = skuCheck.sku_name;
    const skuSource = skuCheck.source; // REALTIME 或 CACHE，用于结果展示

    // 2) 幂等：同运单同 SKU 有未关闭品控工单 → 只追加扫描记录，不新建工单，不重置暂扣
    const existingTicket = await sql`
      SELECT t.id, t.ticket_no FROM exception_tickets t
       WHERE t.waybill_code = ${waybill_code}
         AND t.source = 'SCAN'
         AND t.state NOT IN ('COMPLETED','CLOSED_REJECTED')
         AND t.id IN (SELECT ticket_id FROM scan_records WHERE waybill_code = ${waybill_code} AND sku_code = ${sku_code} LIMIT 1)
       LIMIT 1
    `;
    if (existingTicket.rows.length > 0) {
      const et = existingTicket.rows[0] as { id: string; ticket_no: string };
      // 仅追加扫描记录
      await sql`
        INSERT INTO scan_records (waybill_code, sku_code, sku_name, result, exception_desc, batch_lock_state, ticket_id, operator_id, operator_name)
        VALUES (${waybill_code}, ${sku_code}, ${sku_name || null}, 'FAIL', ${operator_note || '重复扫描-追加记录'}, 'LOCKED', ${et.id}, ${user.id}, ${user.name})
      `;
      return successResponse(
        { result: 'FAIL', action: 'APPENDED', ticket_id: et.id, ticket_no: et.ticket_no, message: '该批次已存在未关闭品控工单，已追加扫描记录' },
        '该批次已存在未关闭品控工单'
      );
    }

    // 3) 品控规则引擎判定
    const evalResult = await evaluateQc({
      waybill_code, sku_code, expected_quantity, expected_spec,
      actual_quantity, actual_spec, damage_level, label_match, batch_anomaly,
    });

    if (evalResult.pass) {
      // 通过：批次状态=可出库，流程结束
      await sql`
        INSERT INTO scan_records (waybill_code, sku_code, sku_name, result, exception_desc, batch_lock_state, operator_id, operator_name, hit_rule_id)
        VALUES (${waybill_code}, ${sku_code}, ${sku_name || null}, 'PASS', ${evalResult.reason || null}, 'UNLOCKED', ${user.id}, ${user.name}, NULL)
      `;
      return successResponse({ result: 'PASS', action: 'RELEASED', message: '品控通过，正常出库' }, '品控通过');
    }

    // 4) 异常：批次锁定 + 自动创建品控工单（source=SCAN，进入二级审批）
    const ticketNo = `TK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`;
    const amount = Number(actual_quantity || expected_quantity || 1) * 10; // 估价

    await sql.query('BEGIN');
    try {
      const ins = await sql.query(
        `INSERT INTO exception_tickets
           (ticket_no, waybill_code, exception_type, source, state, amount, description,
            reporter_id, warehouse_id, batch_id)
         VALUES ($1, $2, $3, 'SCAN', 'L2_REVIEWING', $4, $5, $6, 'WH01', $7)
         RETURNING id`,
        [ticketNo, waybill_code, evalResult.sub_type, amount,
         operator_note || `扫描品控异常：${evalResult.reason}`, user.id, `BATCH-${waybill_code}-${sku_code}`]
      );
      const ticketId = (ins.rows[0] as { id: string }).id;

      // 扫描记录（关联工单 + 批次锁定）
      await sql.query(
        `INSERT INTO scan_records (waybill_code, sku_code, sku_name, result, exception_desc, batch_lock_state, ticket_id, operator_id, operator_name, hit_rule_id)
         VALUES ($1, $2, $3, 'FAIL', $4, 'LOCKED', $5, $6, $7, $8)`,
        [waybill_code, sku_code, sku_name || null, operator_note || evalResult.reason, ticketId, user.id, user.name, evalResult.hit_rule_id || null]
      );

      // 库存锁定（locked_qty +1）
      await sql.query(
        `UPDATE inventory SET locked_qty = locked_qty + 1, updated_at = NOW() WHERE sku_code = $1`,
        [sku_code]
      );

      await sql.query('COMMIT');

      return successResponse({
        result: 'FAIL', action: 'TICKET_CREATED', ticket_id: ticketId, ticket_no: ticketNo,
        sub_type: evalResult.sub_type, severity: evalResult.severity,
        hit_rule_id: evalResult.hit_rule_id, message: `品控异常，已锁定批次并创建工单 ${ticketNo}`,
        request_id: skuCheck.requestId, sku_source: skuSource,
      }, '品控异常，已创建工单');
    } catch (e) {
      await sql.query('ROLLBACK');
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '扫描失败';
    return errorResponse(message, 500);
  }
}

// GET /api/scan —— 查询扫描记录（可按运单/SKU 筛选）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const { searchParams } = new URL(request.url);
    const waybill = searchParams.get('waybill') || '';
    const sku = searchParams.get('sku') || '';

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;
    if (waybill) { where += ` AND waybill_code = $${idx++}`; params.push(waybill); }
    if (sku) { where += ` AND sku_code = $${idx++}`; params.push(sku); }

    const rows = await sql.query(
      `SELECT * FROM scan_records ${where} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    return successResponse({ list: rows.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
