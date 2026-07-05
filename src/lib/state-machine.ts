import type { TicketState, TicketSource, ExceptionType } from '@/types';
import { isLogisticsType } from '@/types';

// 工单状态机：判定一次状态流转是否合法（防御性，后端强制）
// 物流类（MANUAL）：PENDING → L1_REVIEWING → [金额>阈值] L2_REVIEWING → EXECUTING → COMPLETED
// 品控类（SCAN）：直接进入 L2_REVIEWING → EXECUTING → COMPLETED

export interface TransitionInput {
  source: TicketSource;
  type: ExceptionType;
  from: TicketState;
  to: TicketState;
  amount: number;
  l1Threshold: number;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

const LOGISTICS_TRANSITIONS: Record<TicketState, TicketState[]> = {
  PENDING: ['L1_REVIEWING', 'EXECUTING', 'CLOSED_REJECTED'],
  L1_REVIEWING: ['L2_REVIEWING', 'EXECUTING', 'PENDING', 'CLOSED_REJECTED'],
  L2_REVIEWING: ['EXECUTING', 'PENDING', 'CLOSED_REJECTED'],
  EXECUTING: ['COMPLETED'],
  COMPLETED: [],
  CLOSED_REJECTED: ['PENDING'], // 允许重新提交回到待审批（受次数上限约束）
};

const QC_TRANSITIONS: Record<TicketState, TicketState[]> = {
  PENDING: ['L2_REVIEWING', 'EXECUTING', 'CLOSED_REJECTED'],
  L1_REVIEWING: ['L2_REVIEWING', 'EXECUTING', 'CLOSED_REJECTED'],
  L2_REVIEWING: ['EXECUTING', 'CLOSED_REJECTED'],
  EXECUTING: ['COMPLETED'],
  COMPLETED: [],
  CLOSED_REJECTED: [],
};

export function canTransition(input: TransitionInput): TransitionResult {
  const table = isLogisticsType(input.type) ? LOGISTICS_TRANSITIONS : QC_TRANSITIONS;
  const allowed = table[input.from] || [];
  if (!allowed.includes(input.to)) {
    return { ok: false, reason: `非法状态流转：${input.from} → ${input.to}` };
  }
  // 一级审批通过：金额超阈值必须升二级，不得直接进执行中
  if (input.from === 'L1_REVIEWING' && input.to === 'EXECUTING' && input.amount > input.l1Threshold) {
    return { ok: false, reason: `金额 ${input.amount} 超过一级阈值 ${input.l1Threshold}，必须升级二级审批` };
  }
  return { ok: true };
}

// 品控类工单创建时直接进二级审批；物流类工单创建后进待审批→一级
export function initialState(source: TicketSource): TicketState {
  if (source === 'SCAN') return 'L2_REVIEWING';
  return 'PENDING';
}

// 计算审批通过后的下一个状态
export function nextAfterApprove(
  current: TicketState,
  level: 1 | 2,
  amount: number,
  l1Threshold: number,
  source: TicketSource
): TicketState {
  // 品控类工单本就在二级，二级通过 → 执行中
  if (source === 'SCAN') {
    return current === 'L2_REVIEWING' ? 'EXECUTING' : 'EXECUTING';
  }
  // 物流类
  if (level === 1) {
    // 一级通过：金额超阈值 → 二级；否则 → 执行中
    return amount > l1Threshold ? 'L2_REVIEWING' : 'EXECUTING';
  }
  // 二级通过 → 执行中
  return 'EXECUTING';
}

// 终态判定
export function isTerminal(state: TicketState): boolean {
  return state === 'COMPLETED' || state === 'CLOSED_REJECTED';
}

// 当前可执行审批的层级（用于路由待办 & 权限校验）
export function currentApprovalLevel(state: TicketState): 1 | 2 | null {
  switch (state) {
    case 'PENDING':
      return null; // 尚未进入审批
    case 'L1_REVIEWING':
      return 1;
    case 'L2_REVIEWING':
      return 2;
    default:
      return null;
  }
}
