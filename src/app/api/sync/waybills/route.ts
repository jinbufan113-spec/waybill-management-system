import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { listWaybills } from '@/lib/v2-client';
import { getCurrentUser } from '@/lib/auth';

// POST /api/sync/waybills  —— 从 V2 增量同步运单到本地快照表。
// 不传参则从最新拉取；传 cursor 则增量。
// 注意：本地快照是只读缓存，不在此表写运单状态变更。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const { searchParams } = new URL(request.url);
    const batchSize = Math.min(Number(searchParams.get('limit') || 100), 500);
    const startCursor = searchParams.get('cursor') || undefined;

    let cursor = startCursor || undefined;
    let synced = 0;
    let hasMore = true;

    // 最多拉 10 批，避免单次请求超时
    for (let i = 0; i < 10 && hasMore; i++) {
      const result = await listWaybills(cursor, batchSize);
      if (!result.ok) {
        return errorResponse(`同步失败：${result.message}（${result.errorClass}）`, 502, {
          request_id: result.requestId,
          degraded: result.degraded,
        });
      }
      const data = result.data!;
      for (const wb of data.list) {
        // 本地快照：ON CONFLICT 更新，保留最新同步时间
        const skuItems = wb.sku_items || [];
        const amount = wb.estimated_amount || 0;
        const store = wb.store_name || null;
        const rName = wb.receiver_name || null;
        const rPhone = wb.receiver_phone || null;
        const rAddr = wb.receiver_address || null;
        await sql`
          INSERT INTO waybill_snapshots (waybill_code, store_name, receiver_name, receiver_phone, receiver_address, amount, sku_items, synced_at, source)
          VALUES (${wb.waybill_code}, ${store}, ${rName}, ${rPhone}, ${rAddr}, ${amount}, ${JSON.stringify(skuItems)}::jsonb, NOW(), 'SYNC')
          ON CONFLICT (waybill_code) DO UPDATE SET
            store_name = EXCLUDED.store_name,
            receiver_name = EXCLUDED.receiver_name,
            receiver_phone = EXCLUDED.receiver_phone,
            receiver_address = EXCLUDED.receiver_address,
            amount = EXCLUDED.amount,
            sku_items = EXCLUDED.sku_items,
            synced_at = NOW(),
            source = 'SYNC'
        `;
        synced++;
      }
      hasMore = data.has_more;
      cursor = data.next_cursor || undefined;
      if (!cursor) break;
    }

    return successResponse({ synced, has_more: hasMore, next_cursor: cursor }, `同步完成，共 ${synced} 条`);
  } catch (err) {
    const message = err instanceof Error ? err.message : '同步失败';
    return errorResponse(message, 500);
  }
}

// GET /api/sync/waybills  —— 查询本地快照（前端搜索运单用）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const page = Number(searchParams.get('page') || 1);
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100);
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;
    if (q) {
      where += ` AND (waybill_code ILIKE $${idx} OR store_name ILIKE $${idx} OR receiver_name ILIKE $${idx})`;
      params.push(`%${q}%`);
      idx++;
    }

    const cnt = await sql.query(`SELECT COUNT(*)::int AS total FROM waybill_snapshots ${where}`, params);
    const total = (cnt.rows[0] as { total: number }).total;

    const rows = await sql.query(
      `SELECT waybill_code, store_name, receiver_name, receiver_phone, receiver_address,
              amount, sku_items, synced_at, source
         FROM waybill_snapshots ${where}
         ORDER BY synced_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return successResponse({ list: rows.rows, total, page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
