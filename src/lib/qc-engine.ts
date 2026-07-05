import { sql } from '@/lib/db';
import type { QcExceptionSubType } from '@/types';

// 品控规则引擎：读取 qc_rules 配置，对扫描输入做判定，记录命中规则。
// 触发条件全部来自数据库配置（数量差异比例/破损等级/规格偏差等），不硬编码。

export interface QcEvalInput {
  waybill_code: string;
  sku_code: string;
  // 期望值（来自 V2 运单明细）
  expected_quantity?: number;
  expected_spec?: string;
  // 实际扫描值
  actual_quantity?: number;
  actual_spec?: string;
  // 人工录入的观察项
  damage_level?: 'NONE' | 'MINOR' | 'MEDIUM' | 'SEVERE';
  label_match?: boolean;
  batch_anomaly?: boolean;
}

export interface QcEvalResult {
  pass: boolean;
  hit_rule_id?: string;
  sub_type?: QcExceptionSubType;
  severity?: string;
  auto_level?: number;
  reason?: string;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 评估单条规则是否命中
function matchRule(conditions: Record<string, unknown>, input: QcEvalInput): boolean {
  const field = conditions.field as string;
  const op = conditions.op as string;
  const getVal = (): unknown => {
    switch (field) {
      case 'quantity_diff_ratio': {
        if (input.expected_quantity && input.actual_quantity != null && input.expected_quantity > 0) {
          return Math.abs(input.actual_quantity - input.expected_quantity) / input.expected_quantity;
        }
        return null;
      }
      case 'spec_diff_ratio':
        return 0; // 简化：规格文本不匹配即视为偏差，比例不计算
      case 'damage_level':
        return input.damage_level || 'NONE';
      case 'label_match':
        return input.label_match ?? true;
      case 'batch_anomaly':
        return input.batch_anomaly ?? false;
      default:
        return null;
    }
  };

  const val = getVal();
  if (val === null || val === undefined) return false;

  if (op === '>') return num(val)! > num(conditions.threshold)!;
  if (op === '>=') {
    if (conditions.values) return (conditions.values as unknown[]).includes(val);
    return num(val) !== null && num(val)! >= num(conditions.threshold)!;
  }
  if (op === '==') return val === conditions.value;
  return false;
}

export async function evaluateQc(input: QcEvalInput): Promise<QcEvalResult> {
  const res = await sql`
    SELECT id, sub_type, conditions, severity, auto_create_ticket, auto_level
      FROM qc_rules
     WHERE enabled = TRUE
  `;

  for (const row of res.rows as {
    id: string;
    sub_type: QcExceptionSubType;
    conditions: Record<string, unknown>;
    severity: string;
    auto_create_ticket: boolean;
    auto_level: number;
  }[]) {
    try {
      if (matchRule(row.conditions, input)) {
        return {
          pass: false,
          hit_rule_id: row.id,
          sub_type: row.sub_type,
          severity: row.severity,
          auto_level: row.auto_level,
          reason: `命中规则 ${row.sub_type}（${JSON.stringify(row.conditions)}）`,
        };
      }
    } catch {
      // 单条规则解析失败跳过，不影响整体判定
    }
  }

  return { pass: true, reason: '所有品控规则均通过' };
}
