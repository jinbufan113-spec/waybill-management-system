import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { randomUUID } from 'crypto';
import { LOGISTICS_TYPES, QC_TYPES } from '@/types';

// POST /api/seed —— 生成 200+ 条压测工单，覆盖不同状态/类型/来源。
// 用于验证列表筛选/分页/统计在数据量较大时依然流畅（模块4 规模化场景）。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);
  if (!user.roles.includes('qc_supervisor') && !user.roles.includes('approver_l2')) {
    return errorResponse('仅品控主管/二级审批人可生成压测数据', 403);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Number((body as { count?: number }).count || 220), 1000);

    // 取真实的运单号（来自本地快照）
    const wbRes = await sql`SELECT waybill_code FROM waybill_snapshots ORDER BY waybill_code LIMIT 200`;
    const waybills = wbRes.rows.map((r) => (r as { waybill_code: string }).waybill_code);
    if (waybills.length === 0) return errorResponse('请先同步运单快照（/api/sync/waybills）', 400);

    // 取真实用户作为上报人/审批人
    const users = await sql`
      SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'reporter' LIMIT 1
    `;
    const reporterId = users.rows.length > 0 ? (users.rows[0] as { id: number }).id : 1;

    const states = ['PENDING', 'L1_REVIEWING', 'L2_REVIEWING', 'EXECUTING', 'COMPLETED', 'CLOSED_REJECTED'];
    const stateWeights = [0.1, 0.15, 0.15, 0.15, 0.35, 0.1]; // 已完成占比最高
    let created = 0;

    for (let i = 0; i < count; i++) {
      const ticketNo = `TK-SEED-${String(i).padStart(4, '0')}-${randomUUID().slice(0, 6)}`;
      const waybill = waybills[i % waybills.length];
      const isLogistics = Math.random() < 0.5;
      const type = isLogistics
        ? LOGISTICS_TYPES[Math.floor(Math.random() * LOGISTICS_TYPES.length)]
        : QC_TYPES[Math.floor(Math.random() * QC_TYPES.length)];
      const source = isLogistics ? 'MANUAL' : 'SCAN';
      const amount = Math.floor(Math.random() * 1500) + 50;

      // 按权重选状态
      let r = Math.random();
      let state = 'COMPLETED';
      for (let s = 0; s < states.length; s++) {
        r -= stateWeights[s];
        if (r <= 0) { state = states[s]; break; }
      }
      // 品控类工单不会停在 PENDING（直接 L2）
      if (source === 'SCAN' && state === 'PENDING') state = 'L2_REVIEWING';

      const dueAt = (state === 'PENDING' || state === 'L1_REVIEWING' || state === 'L2_REVIEWING')
        ? new Date(Date.now() + (Math.random() * 48 - 12) * 3600 * 1000).toISOString()
        : null;

      try {
        await sql`
          INSERT INTO exception_tickets
            (ticket_no, waybill_code, exception_type, source, state, amount,
             description, reporter_id, warehouse_id, due_at)
          VALUES (${ticketNo}, ${waybill}, ${type}, ${source}, ${state}, ${amount},
                  ${`压测数据-${type}-${i}`}, ${reporterId}, 'WH01', ${dueAt}::timestamptz)
        `;
        created++;
      } catch {
        // 跳过个别失败
      }
    }

    return successResponse({ created, total_target: count }, `已生成 ${created} 条压测工单`);
  } catch (err) {
    const message = err instanceof Error ? err.message : '生成失败';
    return errorResponse(message, 500);
  }
}
