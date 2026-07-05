import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { executeQcAction } from '@/lib/execution-engine';
import { getConfigNumber } from '@/lib/approval-engine';
import type { QcExecutionAction } from '@/types';
import { randomUUID } from 'crypto';

// POST /api/execution/qc-action —— 品控工单执行动作（模块3）
// 品控工单审批通过进入 EXECUTING 后，由品控主管/审批人选择执行动作（放行/退供应商/重采购/降级）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  if (!user.roles.includes('approver_l2') && !user.roles.includes('qc_supervisor')) {
    return errorResponse('仅二级审批人/品控主管可执行品控动作', 403);
  }

  const idempotencyKey = request.headers.get('x-idempotency-key') || `qcexec-${randomUUID()}`;

  try {
    const body = await request.json();
    const { ticket_id, action } = body as { ticket_id: string; action: QcExecutionAction };
    if (!ticket_id || !action) return errorResponse('ticket_id 与 action 必填', 400);

    const cur = await sql`
      SELECT id, state, version, source, amount, waybill_code, exception_type
        FROM exception_tickets WHERE id = ${ticket_id}
    `;
    if (cur.rows.length === 0) return errorResponse('工单不存在', 404);
    const t = cur.rows[0] as { id: string; state: string; version: number; source: string; amount: number; waybill_code: string; exception_type: string };
    if (t.source !== 'SCAN') return errorResponse('仅品控类工单需执行动作', 400);
    if (t.state !== 'EXECUTING') return errorResponse(`工单当前状态 ${t.state} 不可执行（需先审批通过进入执行中）`, 400);

    const l1Threshold = await getConfigNumber('L1_THRESHOLD');
    void l1Threshold;

    await sql.query('BEGIN');
    try {
      // 写一条审批/执行记录用于反查链
      const ar = await sql.query(
        `INSERT INTO approval_records (ticket_id, approver_id, approver_name, level, decision, opinion, is_auto, idempotency_key)
         VALUES ($1, $2, $3, 2, 'APPROVE', $4, TRUE, $5) RETURNING id`,
        [ticket_id, user.id, user.name, `执行品控动作：${action}`, idempotencyKey]
      );
      const approvalId = (ar.rows[0] as { id: string }).id;

      // 执行联动（赔付/库存/批次解锁）—— 同事务
      await executeQcAction(ticket_id, approvalId, action, t.waybill_code, t.amount);

      // 工单完成（乐观锁）
      const upd = await sql.query(
        `UPDATE exception_tickets SET state = 'COMPLETED', due_at = NULL, updated_at = NOW(), version = version + 1
          WHERE id = $1 AND version = $2 AND state = 'EXECUTING' RETURNING id`,
        [ticket_id, t.version]
      );
      if (upd.rows.length === 0) {
        await sql.query('ROLLBACK');
        return errorResponse('执行失败：工单状态已变更，请刷新', 409);
      }

      await sql.query('COMMIT');
      return successResponse({ ticket_id, action, approval_id: approvalId }, '执行完成，工单已关闭');
    } catch (e) {
      await sql.query('ROLLBACK');
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '执行失败';
    return errorResponse(message, 500);
  }
}

// GET /api/execution —— 查询赔付记录与库存变更（模块3 展示 + 可追溯）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const compensations = await sql`
      SELECT c.*, t.ticket_no, t.waybill_code, t.exception_type
        FROM compensation_records c
        LEFT JOIN exception_tickets t ON t.id = c.ticket_id
       ORDER BY c.created_at DESC LIMIT 100
    `;
    const invChanges = await sql`
      SELECT ic.*, t.ticket_no
        FROM inventory_changes ic
        LEFT JOIN exception_tickets t ON t.id = ic.ticket_id
       ORDER BY ic.created_at DESC LIMIT 100
    `;
    const inventory = await sql`SELECT * FROM inventory ORDER BY sku_code ASC`;

    return successResponse({
      compensations: compensations.rows,
      inventory_changes: invChanges.rows,
      inventory: inventory.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
