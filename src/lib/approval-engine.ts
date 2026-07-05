import { sql } from '@/lib/db';

// 分级审批引擎：读 system_config 的阈值，判定层级、超时、重提次数
// 不硬编码任何数值，全部从 system_config 读取（呼应 V2 规则引擎理念）

export async function getConfigNumber(key: string): Promise<number> {
  const res = await sql`SELECT value FROM system_config WHERE key = ${key}`;
  if (res.rows.length === 0) throw new Error(`系统配置缺失：${key}`);
  return Number((res.rows[0] as { value: unknown }).value);
}

export async function getConfigString(key: string): Promise<string> {
  const res = await sql`SELECT value FROM system_config WHERE key = ${key}`;
  if (res.rows.length === 0) throw new Error(`系统配置缺失：${key}`);
  return String((res.rows[0] as { value: unknown }).value);
}

export async function getAllConfig(): Promise<Record<string, unknown>> {
  const res = await sql`SELECT key, value FROM system_config ORDER BY key`;
  const out: Record<string, unknown> = {};
  for (const row of res.rows as { key: string; value: unknown }[]) {
    out[row.key] = row.value;
  }
  return out;
}

// 给工单设定 due_at（进入审批态时调用）
export async function computeDueAt(state: string): Promise<Date | null> {
  if (state === 'PENDING' || state === 'L1_REVIEWING' || state === 'L2_REVIEWING') {
    const hours = await getConfigNumber('APPROVAL_TIMEOUT_HOURS');
    return new Date(Date.now() + hours * 3600 * 1000);
  }
  return null;
}

// 给品控批次锁定设定 due_at（独立短超时）
export async function computeQcHoldDueAt(): Promise<Date> {
  const hours = await getConfigNumber('QC_HOLD_TIMEOUT_HOURS');
  return new Date(Date.now() + hours * 3600 * 1000);
}
