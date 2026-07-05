import { sql } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/response';
import { getCurrentUser } from '@/lib/auth';

// GET /api/sync/monitor —— 接口同步监控数据
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return errorResponse('未登录', 401);

  try {
    const stats = await sql`
      SELECT
        (SELECT COUNT(*) FROM api_sync_logs) AS total_calls,
        (SELECT COUNT(*) FROM api_sync_logs WHERE success) AS success_calls,
        (SELECT COUNT(*) FROM api_sync_logs WHERE created_at > NOW() - INTERVAL '24 hours') AS calls_24h,
        (SELECT COUNT(*) FROM api_sync_logs WHERE success AND created_at > NOW() - INTERVAL '24 hours') AS success_24h,
        (SELECT created_at FROM api_sync_logs ORDER BY created_at DESC LIMIT 1) AS last_sync,
        (SELECT request_id FROM api_sync_logs ORDER BY created_at DESC LIMIT 1) AS last_request_id
    `;
    const s = stats.rows[0] as Record<string, string | null>;

    const recentLogs = await sql`
      SELECT id, request_id, endpoint, method, status_code, duration_ms, success, error_class, created_at
        FROM api_sync_logs
       ORDER BY created_at DESC
       LIMIT 50
    `;

    // 错误分类统计
    const errBreakdown = await sql`
      SELECT COALESCE(error_class, 'UNKNOWN') AS error_class, COUNT(*)::int AS cnt
        FROM api_sync_logs
       WHERE success = FALSE
       GROUP BY error_class
       ORDER BY cnt DESC
    `;

    const total24 = Number(s.calls_24h || 0);
    const success24 = Number(s.success_24h || 0);
    const rate24 = total24 > 0 ? Math.round((success24 / total24) * 1000) / 10 : 0;

    return successResponse({
      total_calls: Number(s.total_calls || 0),
      success_calls: Number(s.success_calls || 0),
      calls_24h: total24,
      success_24h: success24,
      success_rate_24h: rate24,
      last_sync: s.last_sync,
      last_request_id: s.last_request_id,
      recent_logs: recentLogs.rows,
      error_breakdown: errBreakdown.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '查询失败';
    return errorResponse(message, 500);
  }
}
