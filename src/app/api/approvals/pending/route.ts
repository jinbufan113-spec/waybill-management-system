import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';

// GET /api/approvals/pending —— 待当前用户处理的工单（模块2 待办列表）
// 规则：当前用户具备对应层级审批权限，且工单在该层级审批中，且（未指定具体审批人 或 指定给自己）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const roles = user.roles;
    const canL1 = roles.includes('approver_l1') || roles.includes('approver_l2') || roles.includes('qc_supervisor');
    const canL2 = roles.includes('approver_l2') || roles.includes('qc_supervisor');

    // 可处理的层级
    const targetStates: string[] = [];
    if (canL1) targetStates.push('L1_REVIEWING');
    if (canL2) targetStates.push('L2_REVIEWING');
    if (targetStates.length === 0) {
      return successResponse({ list: [], total: 0 });
    }

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get('page') || 1);
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100);
    const offset = (page - 1) * limit;

    const statesParam = targetStates.map((_, i) => `$${i + 1}`).join(',');
    const cnt = await sql.query(
      `SELECT COUNT(*)::int AS total FROM exception_tickets
        WHERE state IN (${statesParam})
          AND reporter_id <> $${targetStates.length + 1}`,
      [...targetStates, user.id]
    );
    const total = (cnt.rows[0] as { total: number }).total;

    const rows = await sql.query(
      `SELECT t.id, t.ticket_no, t.waybill_code, t.exception_type, t.source, t.state, t.amount,
              t.description, t.due_at, t.created_at, t.resubmit_count,
              u.name AS reporter_name,
              t.due_at < NOW() AS is_overdue
         FROM exception_tickets t
         LEFT JOIN users u ON u.id = t.reporter_id
        WHERE t.state IN (${statesParam})
          AND t.reporter_id <> $${targetStates.length + 1}
        ORDER BY (CASE WHEN t.due_at < NOW() THEN 0 ELSE 1 END), t.due_at ASC NULLS LAST, t.created_at DESC
        LIMIT $${targetStates.length + 2} OFFSET $${targetStates.length + 3}`,
      [...targetStates, user.id, limit, offset]
    );

    return successResponse({ list: rows.rows, total, page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
