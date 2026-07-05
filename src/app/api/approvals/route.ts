import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { getConfigNumber, computeDueAt } from '@/lib/approval-engine';
import { canTransition, nextAfterApprove, isTerminal } from '@/lib/state-machine';
import { executeApprovalActions } from '@/lib/execution-engine';
import type { RoleCode, ExceptionType } from '@/types';
import { randomUUID } from 'crypto';

// POST /api/approvals —— 审批动作（模块2核心）
// 幂等：Idempotency-Key header；并发：乐观锁 version；权限：后端校验层级 + 自批禁止。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  // Idempotency-Key（幂等）
  const idempotencyKey = request.headers.get('x-idempotency-key') || `auto-${randomUUID()}`;

  try {
    const body = await request.json();
    const { ticket_id, decision, opinion, level } = body as {
      ticket_id: string;
      decision: 'APPROVE' | 'REJECT';
      opinion?: string;
      level: 1 | 2;
    };

    if (!ticket_id || !decision || !level) {
      return errorResponse('ticket_id / decision / level 必填', 400);
    }

    // 1) 幂等：同 key 直接返回既有结果
    const exist = await sql`
      SELECT a.id, a.ticket_id, a.decision FROM approval_records a
       WHERE a.idempotency_key = ${idempotencyKey}
       LIMIT 1
    `;
    if (exist.rows.length > 0) {
      return successResponse(exist.rows[0], '操作已处理（幂等返回）');
    }

    // 2) 锁定工单（带 version 乐观锁）
    const cur = await sql`
      SELECT id, ticket_no, state, version, amount, exception_type, source,
             reporter_id, current_approver_id, resubmit_count
        FROM exception_tickets WHERE id = ${ticket_id}
    `;
    if (cur.rows.length === 0) return errorResponse('工单不存在', 404);
    const t = cur.rows[0] as {
      id: string; ticket_no: string; state: string; version: number; amount: number;
      exception_type: string; source: string; reporter_id: number;
      current_approver_id: number | null; resubmit_count: number;
    };

    if (isTerminal(t.state as never)) {
      return errorResponse(`工单已处于终态 ${t.state}，不可审批`, 400);
    }

    // 3) 权限边界（后端强制）
    // 3a) 自批禁止
    if (t.reporter_id === user.id) {
      return errorResponse('不能审批自己提交的工单', 403);
    }
    // 3b) 层级权限：一级需 approver_l1，二级需 approver_l2（品控主管也具备二级权限）
    const roles = user.roles as RoleCode[];
    const hasL1 = roles.includes('approver_l1') || roles.includes('approver_l2') || roles.includes('qc_supervisor');
    const hasL2 = roles.includes('approver_l2') || roles.includes('qc_supervisor');
    if (level === 1 && !hasL1) return errorResponse('无一级审批权限', 403);
    if (level === 2 && !hasL2) return errorResponse('无二级审批权限', 403);
    // 3c) 层级与工单当前审批态匹配
    const expectedLevel = t.state === 'L1_REVIEWING' ? 1 : t.state === 'L2_REVIEWING' ? 2 : null;
    if (expectedLevel === null) {
      return errorResponse(`工单当前状态 ${t.state} 不可审批`, 400);
    }
    // 一级审批人不能直接操作二级审批中的工单
    if (expectedLevel === 2 && level === 1) {
      return errorResponse('该工单已进入二级审批，一级审批人无权操作', 403);
    }

    const l1Threshold = await getConfigNumber('L1_THRESHOLD');
    const maxResubmit = await getConfigNumber('MAX_RESUBMIT');

    let newState: string;
    let dueIso: string | null = null;
    let newApproverId: number | null = null;
    let compApprovalId: string | null = null; // 用于执行联动

    if (decision === 'APPROVE') {
      newState = nextAfterApprove(t.state as never, level, t.amount, l1Threshold, t.source as never);
      const transition = canTransition({
        source: t.source as never, type: t.exception_type as never,
        from: t.state as never, to: newState as never, amount: t.amount, l1Threshold,
      });
      if (!transition.ok) return errorResponse(transition.reason || '非法状态流转', 400);

      if (newState === 'L2_REVIEWING') {
        const due = await computeDueAt('L2_REVIEWING');
        dueIso = due ? due.toISOString() : null;
        // 分配二级审批人
        const approver = await sql`
          SELECT u.id FROM users u
            JOIN user_roles ur ON ur.user_id = u.id
            JOIN roles r ON r.id = ur.role_id
           WHERE r.code = 'approver_l2' AND u.disabled = FALSE
             AND u.id <> ${t.reporter_id}
           ORDER BY RANDOM() LIMIT 1
        `;
        newApproverId = approver.rows.length > 0 ? (approver.rows[0] as { id: number }).id : null;
      } else if (newState === 'EXECUTING') {
        // 审批通过进入执行：执行引擎在事务内联动赔付/库存
        dueIso = null;
      }
    } else {
      // REJECT：回到待审批（重新提交，受次数上限约束）；超限则关闭
      const newCount = t.resubmit_count + 1;
      if (newCount > maxResubmit) {
        newState = 'CLOSED_REJECTED';
      } else {
        newState = 'PENDING';
        const due = await computeDueAt('PENDING');
        dueIso = due ? due.toISOString() : null;
      }
    }

    // 4) 事务：写审批记录 + 更新工单状态（+执行联动）—— 杜绝中间态
    await sql.query('BEGIN');
    try {
      // 写审批记录（带 idempotency_key 唯一约束，防并发重复）
      const ar = await sql.query(
        `INSERT INTO approval_records (ticket_id, approver_id, approver_name, level, decision, opinion, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [ticket_id, user.id, user.name, level, decision, opinion || '', idempotencyKey]
      );
      compApprovalId = (ar.rows[0] as { id: string }).id;

      // 更新工单（乐观锁）
      const upd = await sql.query(
        `UPDATE exception_tickets
            SET state = $1, current_approver_id = $2, due_at = $3,
                resubmit_count = CASE WHEN $4 = 'REJECT' THEN resubmit_count + 1 ELSE resubmit_count END,
                updated_at = NOW(), version = version + 1
          WHERE id = $5 AND version = $6 AND state = $7
          RETURNING id, version`,
        [newState, newApproverId, dueIso, decision, ticket_id, t.version, t.state]
      );
      if (upd.rows.length === 0) {
        await sql.query('ROLLBACK');
        return errorResponse('该工单已被处理，请刷新后重试', 409);
      }

      // 执行联动：审批通过进入执行态时，同事务内生成赔付/库存变更
      if (decision === 'APPROVE' && newState === 'EXECUTING') {
        await executeApprovalActions(ticket_id, compApprovalId!, t.exception_type as ExceptionType, t.source);
      }

      await sql.query('COMMIT');
    } catch (e) {
      await sql.query('ROLLBACK');
      throw e;
    }

    return successResponse({
      ticket_id,
      decision,
      level,
      new_state: newState,
      approval_id: compApprovalId,
    }, decision === 'APPROVE' ? '审批通过' : '已拒绝');
  } catch (err) {
    const message = err instanceof Error ? err.message : '审批失败';
    return errorResponse(message, 500);
  }
}
