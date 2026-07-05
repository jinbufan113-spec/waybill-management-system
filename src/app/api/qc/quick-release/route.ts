import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { randomUUID } from 'crypto';

// POST /api/qc/quick-release —— 品控主管误判快速放行（模块7核心）
// 仅 qc_supervisor 可操作；必须填写复核原因（留痕）；批次解锁 + 工单关闭（绕过完整审批）。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  if (!user.roles.includes('qc_supervisor')) {
    return errorResponse('仅品控主管可执行误判快速放行', 403);
  }

  const idempotencyKey = request.headers.get('x-idempotency-key') || `qr-${randomUUID()}`;

  try {
    const body = await request.json();
    const { ticket_id, reason } = body as { ticket_id: string; reason: string };
    if (!ticket_id || !reason || !reason.trim()) {
      return errorResponse('ticket_id 与复核原因（reason）必填，不允许静默放行', 400);
    }

    // 幂等
    const exist = await sql`
      SELECT id FROM approval_records WHERE idempotency_key = ${idempotencyKey} LIMIT 1
    `;
    if (exist.rows.length > 0) {
      return successResponse({ already: true }, '操作已处理（幂等返回）');
    }

    const cur = await sql`
      SELECT id, ticket_no, waybill_code, state, version, exception_type, source
        FROM exception_tickets WHERE id = ${ticket_id}
    `;
    if (cur.rows.length === 0) return errorResponse('工单不存在', 404);
    const t = cur.rows[0] as { id: string; ticket_no: string; state: string; version: number; exception_type: string; source: string };
    if (t.source !== 'SCAN') {
      return errorResponse('误判快速放行仅适用于品控类工单', 400);
    }
    if (t.state === 'COMPLETED' || t.state === 'CLOSED_REJECTED') {
      return errorResponse(`工单已 ${t.state}`, 400);
    }

    await sql.query('BEGIN');
    try {
      // 留痕：写一条审批记录（标注 is_auto + 误判放行 reason）
      await sql.query(
        `INSERT INTO approval_records (ticket_id, approver_id, approver_name, level, decision, opinion, is_auto, idempotency_key)
         VALUES ($1, $2, $3, 2, 'APPROVE', $4, TRUE, $5)`,
        [ticket_id, user.id, user.name, `【误判快速放行】${reason}`, idempotencyKey]
      );

      // 工单 → 已完成（乐观锁）
      const upd = await sql.query(
        `UPDATE exception_tickets
            SET state = 'COMPLETED', qc_action = 'RELEASE', current_approver_id = $1,
                due_at = NULL, updated_at = NOW(), version = version + 1
          WHERE id = $2 AND version = $3
          RETURNING id`,
        [user.id, ticket_id, t.version]
      );
      if (upd.rows.length === 0) {
        await sql.query('ROLLBACK');
        return errorResponse('放行失败：工单状态已变更，请刷新', 409);
      }

      // 同事务解锁批次
      await sql.query(
        `UPDATE scan_records SET batch_lock_state = 'UNLOCKED' WHERE ticket_id = $1`,
        [ticket_id]
      );

      // 解锁库存 locked_qty
      const skuRes = await sql.query(`SELECT sku_code FROM scan_records WHERE ticket_id = $1 LIMIT 1`, [ticket_id]);
      if (skuRes.rows.length > 0) {
        const skuCode = (skuRes.rows[0] as { sku_code: string }).sku_code;
        await sql.query(
          `UPDATE inventory SET locked_qty = GREATEST(locked_qty - 1, 0), updated_at = NOW() WHERE sku_code = $1`,
          [skuCode]
        );
      }

      await sql.query('COMMIT');
    } catch (e) {
      await sql.query('ROLLBACK');
      throw e;
    }

    return successResponse({ ticket_id, action: 'QUICK_RELEASE', operator: user.name }, '已快速放行（留痕完成）');
  } catch (err) {
    const message = err instanceof Error ? err.message : '放行失败';
    return errorResponse(message, 500);
  }
}
