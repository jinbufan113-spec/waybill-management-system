import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { validateWaybillForReport, markException } from '@/lib/v2-client';
import { initialState } from '@/lib/state-machine';
import { isLogisticsType } from '@/types';
import { randomUUID } from 'crypto';

// POST /api/tickets —— 异常工单上报（模块1）
// 关键：发起上报时实时调用 V2 接口校验运单存在性（不依赖本地快照）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  if (!user.roles.includes('reporter') && !user.roles.includes('approver_l1') && !user.roles.includes('approver_l2') && !user.roles.includes('qc_supervisor')) {
    return errorResponse('无上报权限', 403);
  }

  try {
    const body = await request.json();
    const {
      waybill_code,
      exception_type,
      amount,
      description,
      ai_suggestion, // 可选，前端透传 AI 建议结果（仅记录，不自动执行）
    } = body as {
      waybill_code: string;
      exception_type: string;
      amount?: number;
      description?: string;
      ai_suggestion?: unknown;
    };

    if (!waybill_code || !exception_type) {
      return errorResponse('运单号与异常类型必填', 400);
    }
    if (!isLogisticsType(exception_type)) {
      // 手工上报路径只接受物流类异常（品控类由扫描自动触发）
      return errorResponse('手工上报仅支持物流类异常（丢件/破损/拒收/超时未签收/地址错误）', 400);
    }

    // 1) 实时调用 V2 校验运单存在性（核心：杜绝伪对接）
    const validation = await validateWaybillForReport(waybill_code);
    if (!validation.valid) {
      return errorResponse(`运单校验失败：${validation.message}`, 400, { source: validation.source, request_id: validation.requestId });
    }

    // 2) 归属校验（单租户假设：当前所有用户属于 WH01，工单也归 WH01；多租户扩展见假设文档）
    // 这里只做基础校验：运单必须存在于本地快照或 V2（已在第1步保证）

    // 3) 同类型未关闭工单去重
    const dup = await sql`
      SELECT id, ticket_no, state FROM exception_tickets
       WHERE waybill_code = ${waybill_code}
         AND exception_type = ${exception_type}
         AND state NOT IN ('COMPLETED', 'CLOSED_REJECTED')
       LIMIT 1
    `;
    if (dup.rows.length > 0) {
      const d = dup.rows[0] as { ticket_no: string; state: string };
      return errorResponse(`该运单存在同类型未关闭工单：${d.ticket_no}（${d.state}）`, 409);
    }

    // 4) 金额：优先取上报值，否则用 V2 估算金额
    const finalAmount = Number(amount ?? validation.detail?.estimated_amount ?? 0);

    // 5) 工单号生成：TK-日期-短UUID
    const ticketNo = `TK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`;

    // 物流类手工上报：初始状态 PENDING（待提交进入一级审批）
    const state = initialState('MANUAL');

    const inserted = await sql`
      INSERT INTO exception_tickets
        (ticket_no, waybill_code, exception_type, source, state, amount, description,
         reporter_id, warehouse_id, ai_suggestion)
      VALUES (${ticketNo}, ${waybill_code}, ${exception_type}, 'MANUAL', ${state}, ${finalAmount},
              ${description || null}, ${user.id}, ${user.warehouse_id || 'WH01'},
              ${ai_suggestion ? JSON.stringify(ai_suggestion) : null}::jsonb)
      RETURNING id, ticket_no
    `;
    const t = inserted.rows[0] as { id: string; ticket_no: string };

    // 6) 同步刷新本地快照（若实时拉到了详情）
    if (validation.detail && validation.source === 'REALTIME') {
      const wb = validation.detail;
      await sql`
        INSERT INTO waybill_snapshots (waybill_code, store_name, receiver_name, receiver_phone, receiver_address, amount, sku_items, synced_at, source)
        VALUES (${wb.waybill_code}, ${wb.store_name || null}, ${wb.receiver_name || null}, ${wb.receiver_phone || null},
                ${wb.receiver_address || null}, ${wb.estimated_amount || 0}, ${JSON.stringify(wb.sku_items || [])}::jsonb, NOW(), 'REALTIME')
        ON CONFLICT (waybill_code) DO UPDATE SET
          store_name = EXCLUDED.store_name, receiver_name = EXCLUDED.receiver_name,
          receiver_phone = EXCLUDED.receiver_phone, receiver_address = EXCLUDED.receiver_address,
          amount = EXCLUDED.amount, sku_items = EXCLUDED.sku_items, synced_at = NOW(), source = 'REALTIME'
      `;
    }

    // 7) 可选：异常标记回写 V2（失败不阻塞）
    void markException(waybill_code, t.id, 'mark', `V3 异常工单 ${ticketNo}`);

    return successResponse(
      { id: t.id, ticket_no: t.ticket_no, state, data_source: validation.source, request_id: validation.requestId },
      `工单创建成功（运单信息：${validation.source === 'REALTIME' ? '实时获取自 V2' : '本地缓存，可能非最新'}）`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建失败';
    return errorResponse(message, 500);
  }
}

// GET /api/tickets —— 工单列表（模块4）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state') || '';
    const type = searchParams.get('type') || '';
    const source = searchParams.get('source') || '';
    const waybill = searchParams.get('waybill') || '';
    const keyword = searchParams.get('q') || '';
    const page = Number(searchParams.get('page') || 1);
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100);
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;
    if (state) { where += ` AND t.state = $${idx++}`; params.push(state); }
    if (type) { where += ` AND t.exception_type = $${idx++}`; params.push(type); }
    if (source) { where += ` AND t.source = $${idx++}`; params.push(source); }
    if (waybill) { where += ` AND t.waybill_code = $${idx++}`; params.push(waybill); }
    if (keyword) {
      where += ` AND (t.ticket_no ILIKE $${idx} OR t.waybill_code ILIKE $${idx})`;
      params.push(`%${keyword}%`);
      idx++;
    }

    const cnt = await sql.query(
      `SELECT COUNT(*)::int AS total FROM exception_tickets t ${where}`,
      params
    );
    const total = (cnt.rows[0] as { total: number }).total;

    const rows = await sql.query(
      `SELECT t.id, t.ticket_no, t.waybill_code, t.exception_type, t.source, t.state,
              t.amount, t.description, t.resubmit_count, t.version, t.due_at,
              t.qc_action, t.created_at, t.updated_at,
              u.name AS reporter_name,
              t.due_at < NOW() AND t.state IN ('PENDING','L1_REVIEWING','L2_REVIEWING') AS is_overdue
         FROM exception_tickets t
         LEFT JOIN users u ON u.id = t.reporter_id
         ${where}
         ORDER BY t.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return successResponse({ list: rows.rows, total, page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
