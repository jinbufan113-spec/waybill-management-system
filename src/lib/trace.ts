import { randomUUID } from 'crypto';
import { sql } from '@/lib/db';

// 生成可追踪的 Request-Id（跨系统调用链路用）
export function newRequestId(prefix = 'req'): string {
  return `${prefix}_${randomUUID()}`;
}

// 简单入参摘要（避免把大字段写进日志，仅前 200 字符）
export function digestParams(params: unknown): string {
  try {
    const s = typeof params === 'string' ? params : JSON.stringify(params);
    return s.length > 200 ? s.slice(0, 200) + '...' : s;
  } catch {
    return String(params).slice(0, 200);
  }
}

export interface LogCallInput {
  request_id: string;
  endpoint: string;
  method: string;
  params_digest: string;
  status_code: number | null;
  duration_ms: number | null;
  success: boolean;
  error_class?: string | null;
}

export async function logApiCall(input: LogCallInput): Promise<void> {
  try {
    await sql`
      INSERT INTO api_sync_logs
        (request_id, endpoint, method, params_digest, status_code, duration_ms, success, error_class)
      VALUES (${input.request_id}, ${input.endpoint}, ${input.method}, ${input.params_digest},
              ${input.status_code}, ${input.duration_ms}, ${input.success}, ${input.error_class ?? null})
    `;
  } catch (e) {
    // 日志失败不影响主流程，仅控制台告警
    console.warn('[trace] logApiCall failed:', e instanceof Error ? e.message : e);
  }
}

// 把错误分类成可排查的标签（区分 V2 404 运单不存在 vs 网络超时等）
export function classifyError(err: unknown): string {
  if (!err) return 'UNKNOWN';
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|abort/i.test(msg)) return 'TIMEOUT';
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(msg)) return 'NETWORK_UNREACHABLE';
  if (/404|not found|不存在/i.test(msg)) return 'NOT_FOUND';
  if (/401|unauthorized|无效.*key|api key/i.test(msg)) return 'UNAUTHORIZED';
  if (/5\d{2}/.test(msg)) return 'UPSTREAM_5XX';
  return 'OTHER';
}
