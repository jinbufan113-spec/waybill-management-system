import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';
import { getWaybill } from '@/lib/v2-client';

// GET /api/tickets/[id] —— 工单详情（含审计日志、运单信息+数据来源标注）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  const { id } = await params;

  try {
    const ticketRes = await sql`
      SELECT t.*, u.name AS reporter_name, ua.name AS current_approver_name
        FROM exception_tickets t
        LEFT JOIN users u ON u.id = t.reporter_id
        LEFT JOIN users ua ON ua.id = t.current_approver_id
       WHERE t.id = ${id}
    `;
    if (ticketRes.rows.length === 0) return errorResponse('工单不存在', 404);
    const ticket = ticketRes.rows[0];

    // 审计日志：审批记录 + 扫描记录 + 赔付记录 + 库存变更，按时间合并
    const approvals = await sql`
      SELECT a.*, u.name AS approver_name
        FROM approval_records a LEFT JOIN users u ON u.id = a.approver_id
       WHERE a.ticket_id = ${id} ORDER BY a.created_at ASC
    `;
    const compensations = await sql`
      SELECT c.* FROM compensation_records c WHERE c.ticket_id = ${id} ORDER BY c.created_at ASC
    `;
    const scans = await sql`
      SELECT s.*, u.name AS operator_name
        FROM scan_records s LEFT JOIN users u ON u.id = s.operator_id
       WHERE s.ticket_id = ${id} ORDER BY s.created_at ASC
    `;
    const invChanges = await sql`
      SELECT * FROM inventory_changes WHERE ticket_id = ${id} ORDER BY created_at ASC
    `;

    // 运单信息：尝试实时拉取 V2，失败则用本地缓存（标注来源）
    const waybillCode = (ticket as { waybill_code: string }).waybill_code;
    let waybillInfo: { data: unknown; source: string; synced_at?: string | null; request_id?: string } | null = null;
    const realtime = await getWaybill(waybillCode);
    if (realtime.ok && realtime.data) {
      waybillInfo = { data: realtime.data, source: 'REALTIME', request_id: realtime.requestId };
    } else {
      const snap = await sql`
        SELECT waybill_code, store_name, receiver_name, receiver_phone, receiver_address, amount, sku_items, synced_at
          FROM waybill_snapshots WHERE waybill_code = ${waybillCode}
      `;
      if (snap.rows.length > 0) {
        waybillInfo = { data: snap.rows[0], source: 'CACHE', synced_at: (snap.rows[0] as { synced_at: string }).synced_at, request_id: realtime.requestId };
      }
    }

    return successResponse({
      ticket,
      approvals: approvals.rows,
      compensations: compensations.rows,
      scans: scans.rows,
      inventory_changes: invChanges.rows,
      waybill_info: waybillInfo,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
