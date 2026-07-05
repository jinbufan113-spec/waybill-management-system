import { sql } from '@/lib/db';
import { newRequestId, digestParams, logApiCall, classifyError } from '@/lib/trace';

const V2_BASE_URL = process.env.V2_BASE_URL || 'http://localhost:3000';
const V2_API_KEY = process.env.EXTERNAL_API_KEY || '';
const TIMEOUT_MS = 8000; // 单次请求超时
const MAX_RETRY = 1; // 失败重试 1 次（共 2 次尝试）

export interface WaybillDetail {
  waybill_code: string;
  exists: boolean;
  store_name?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  batch_id?: string;
  created_at?: string;
  estimated_amount?: number;
  sku_items: { sku_code: string; sku_name: string; sku_quantity: number; sku_spec?: string }[];
}

export interface V2Result<T> {
  ok: boolean;
  data?: T;
  status?: number;
  requestId: string;
  errorClass?: string;
  message?: string;
  degraded: boolean; // 是否走了降级（本地缓存）
}

// 单次 fetch（含超时）
async function fetchOnce(path: string, requestId: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${V2_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': V2_API_KEY,
        'X-Request-Id': requestId,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// 带重试 + 日志的统一调用
async function callV2<T>(
  endpoint: string,
  method: string,
  params: unknown,
  pathBuilder: (rid: string) => string,
  body?: unknown
): Promise<V2Result<T>> {
  const requestId = newRequestId('v3');
  const paramsDigest = digestParams(params);
  const start = Date.now();
  let lastErr: unknown = null;
  let lastStatus: number | null = null;
  let lastBody: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const { status, body: respBody } = await fetchOnce(pathBuilder(requestId), requestId, body ? { method, body: JSON.stringify(body) } : undefined);
      lastStatus = status;
      lastBody = respBody;
      const ok = status >= 200 && status < 300 && (respBody as { success?: boolean })?.success !== false;
      if (ok || status === 404 || status === 401) {
        // 成功 或 业务级失败（404/401）不重试
        const duration = Date.now() - start;
        await logApiCall({
          request_id: requestId,
          endpoint,
          method,
          params_digest: paramsDigest,
          status_code: status,
          duration_ms: duration,
          success: ok,
          error_class: ok ? null : classifyError((respBody as { message?: string })?.message || `status ${status}`),
        });
        return {
          ok,
          data: ok ? ((respBody as { data: T }).data) : undefined,
          status,
          requestId,
          errorClass: ok ? undefined : classifyError((respBody as { message?: string })?.message),
          message: (respBody as { message?: string })?.message,
          degraded: false,
        };
      }
      lastErr = new Error((respBody as { message?: string })?.message || `status ${status}`);
    } catch (e) {
      lastErr = e;
      lastStatus = null;
    }
    // 网络错误/5xx 进入重试
  }

  const duration = Date.now() - start;
  const errorClass = classifyError(lastErr);
  await logApiCall({
    request_id: requestId,
    endpoint,
    method,
    params_digest: paramsDigest,
    status_code: lastStatus,
    duration_ms: duration,
    success: false,
    error_class: errorClass,
  });
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { ok: false, status: lastStatus ?? undefined, requestId, errorClass, message: msg, degraded: false };
}

// —— 对外能力 ——

// 校验运单是否存在 + 获取详情（发起异常上报时实时校验，不依赖本地快照）
export async function getWaybill(code: string): Promise<V2Result<WaybillDetail>> {
  return callV2<WaybillDetail>(
    `GET /api/external/waybills/${code}`,
    'GET',
    { code },
    () => `/api/external/waybills/${encodeURIComponent(code)}`
  );
}

// 校验 SKU 是否归属于指定运单
export async function checkSkuBelongs(code: string, sku: string): Promise<V2Result<{ belongs: boolean; sku_name?: string; sku_quantity?: number }>> {
  return callV2(
    `GET /api/external/waybills/${code}/skus/${sku}`,
    'GET',
    { code, sku },
    () => `/api/external/waybills/${encodeURIComponent(code)}/skus/${encodeURIComponent(sku)}`
  );
}

// 分页拉取运单列表（快照初始化/增量同步）
export async function listWaybills(cursor?: string, limit = 100): Promise<V2Result<{ list: WaybillDetail[]; next_cursor: string | null; has_more: boolean }>> {
  const q = cursor ? `?cursor=${cursor}&limit=${limit}` : `?limit=${limit}`;
  return callV2(
    'GET /api/external/waybills',
    'GET',
    { cursor, limit },
    () => `/api/external/waybills${q}`
  );
}

// 可选：异常标记回写 V2
export async function markException(code: string, sourceTicketId: string, action: 'mark' | 'clear', note?: string): Promise<V2Result<unknown>> {
  return callV2(
    `POST /api/external/waybills/${code}/exception-mark`,
    'POST',
    { code, source_ticket_id: sourceTicketId, action },
    () => `/api/external/waybills/${encodeURIComponent(code)}/exception-mark`,
    { source_ticket_id: sourceTicketId, action, note }
  );
}

// —— 降级：从本地快照表读最后一次同步数据 ——

export interface SnapshotRow {
  waybill_code: string;
  store_name?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  amount?: number;
  sku_items?: unknown;
  synced_at: string;
}

export async function getLocalSnapshot(code: string): Promise<SnapshotRow | null> {
  try {
    const res = await sql`
      SELECT waybill_code, store_name, receiver_name, receiver_phone, receiver_address,
             amount, sku_items, synced_at
        FROM waybill_snapshots
       WHERE waybill_code = ${code}
       LIMIT 1
    `;
    return (res.rows[0] as SnapshotRow) || null;
  } catch {
    return null;
  }
}

// 上报时的"实时校验 + 失败降级"组合：实时调 V2，失败则回退本地快照
export async function validateWaybillForReport(code: string): Promise<{
  valid: boolean;
  detail?: WaybillDetail;
  snapshot?: SnapshotRow | null;
  source: 'REALTIME' | 'CACHE' | 'UNAVAILABLE';
  requestId: string;
  message?: string;
}> {
  const result = await getWaybill(code);
  if (result.ok && result.data) {
    return { valid: true, detail: result.data, source: 'REALTIME', requestId: result.requestId };
  }
  // 404 = 运单真的不存在，不算降级，应阻止上报
  if (result.status === 404) {
    return { valid: false, source: 'REALTIME', requestId: result.requestId, message: result.message || '运单不存在' };
  }
  // 其他失败 → 降级到本地快照
  const snap = await getLocalSnapshot(code);
  if (snap) {
    return { valid: true, snapshot: snap, source: 'CACHE', requestId: result.requestId, message: `V2 不可用，使用本地缓存（同步于 ${snap.synced_at}）` };
  }
  return { valid: false, source: 'UNAVAILABLE', requestId: result.requestId, message: result.message || 'V2 不可用且无本地缓存' };
}
