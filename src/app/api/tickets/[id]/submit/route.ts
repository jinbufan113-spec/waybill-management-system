import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { getConfigNumber, computeDueAt } from '@/lib/approval-engine';

// POST /api/tickets/[id]/submit —— 提交进入一级审批（PENDING → L1_REVIEWING）
// 分配一级审批人（任选一个 enabled 的 approver_l1）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  const { id } = await params;

  try {
    const cur = await sql`SELECT id, state, version, reporter_id FROM exception_tickets WHERE id = ${id}`;
    if (cur.rows.length === 0) return errorResponse('工单不存在', 404);
    const t = cur.rows[0] as { state: string; version: number; reporter_id: number };
    if (t.state !== 'PENDING') return errorResponse(`当前状态 ${t.state} 不可提交`, 400);

    // 找一个 enabled 的一级审批人
    const approver = await sql`
      SELECT u.id FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'approver_l1' AND u.disabled = FALSE
         AND u.id <> ${t.reporter_id}
       ORDER BY RANDOM() LIMIT 1
    `;
    if (approver.rows.length === 0) return errorResponse('无可用的一级审批人', 503);

    const approverId = (approver.rows[0] as { id: number }).id;
    const l1Threshold = await getConfigNumber('L1_THRESHOLD');
    void l1Threshold;
    const due = await computeDueAt('L1_REVIEWING');
    const dueIso = due ? due.toISOString() : null;

    const updated = await sql`
      UPDATE exception_tickets
         SET state = 'L1_REVIEWING', current_approver_id = ${approverId},
             due_at = ${dueIso}, updated_at = NOW(), version = version + 1
       WHERE id = ${id} AND version = ${t.version} AND state = 'PENDING'
       RETURNING id, state
    `;
    if (updated.rows.length === 0) {
      return errorResponse('提交失败：工单状态已被他人变更，请刷新', 409);
    }

    return successResponse(updated.rows[0], '已提交一级审批');
  } catch (err) {
    const message = err instanceof Error ? err.message : '提交失败';
    return errorResponse(message, 500);
  }
}
