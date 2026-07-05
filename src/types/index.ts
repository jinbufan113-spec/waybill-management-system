// V3 领域类型定义

export type RoleCode = 'reporter' | 'approver_l1' | 'approver_l2' | 'qc_supervisor';

export interface User {
  id: number;
  name: string;
  username: string;
  roles: RoleCode[];
  warehouse_id?: string | null;
  disabled?: boolean;
}

// 异常类型
export type LogisticsExceptionType =
  | 'LOST' // 丢件
  | 'DAMAGED' // 破损
  | 'REFUSED' // 客户拒收
  | 'TIMEOUT_UNSIGNED' // 超时未签收
  | 'WRONG_ADDRESS'; // 收货地址错误

export type QcExceptionSubType =
  | 'QTY_MISMATCH' // 数量不符
  | 'APPEARANCE_DAMAGE' // 外观破损
  | 'SPEC_MISMATCH' // 规格不符
  | 'LABEL_ERROR' // 标签错误
  | 'BATCH_ANOMALY'; // 批次异常

export type ExceptionType = LogisticsExceptionType | QcExceptionSubType;

export const LOGISTICS_TYPES: LogisticsExceptionType[] = [
  'LOST',
  'DAMAGED',
  'REFUSED',
  'TIMEOUT_UNSIGNED',
  'WRONG_ADDRESS',
];
export const QC_TYPES: QcExceptionSubType[] = [
  'QTY_MISMATCH',
  'APPEARANCE_DAMAGE',
  'SPEC_MISMATCH',
  'LABEL_ERROR',
  'BATCH_ANOMALY',
];

export function isLogisticsType(t: string): boolean {
  return (LOGISTICS_TYPES as string[]).includes(t);
}

// 工单来源
export type TicketSource = 'MANUAL' | 'SCAN';

// 工单状态机
export type TicketState =
  | 'PENDING' // 待审批
  | 'L1_REVIEWING' // 一级审批中
  | 'L2_REVIEWING' // 二级审批中
  | 'EXECUTING' // 执行中
  | 'COMPLETED' // 已完成
  | 'CLOSED_REJECTED'; // 已关闭-驳回

export const TERMINAL_STATES: TicketState[] = ['COMPLETED', 'CLOSED_REJECTED'];

// 扫描批次锁定状态（独立于工单状态）
export type BatchLockState = 'UNLOCKED' | 'LOCKED';

// 品控执行动作（品控类工单专有）
export type QcExecutionAction =
  | 'RELEASE' // 放行（解锁，无赔付）
  | 'RETURN_SUPPLIER' // 退回供应商 + 追偿
  | 'REPURCHASE' // 重新采购 + 追偿
  | 'DOWNGRADE'; // 降级处理 + 追偿差价

// 赔付方向
export type PaymentDirection = 'CUSTOMER' | 'SUPPLIER';

export interface ExceptionTicket {
  id: string;
  ticket_no: string;
  waybill_code: string;
  exception_type: ExceptionType;
  source: TicketSource;
  state: TicketState;
  amount: number;
  description: string;
  reporter_id: number;
  reporter_name?: string;
  current_approver_id?: number | null;
  resubmit_count: number;
  version: number; // 乐观锁
  due_at?: string | null;
  batch_id?: string | null; // 关联扫描批次（品控类）
  warehouse_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRecord {
  id: string;
  ticket_id: string;
  approver_id: number;
  approver_name?: string;
  level: 1 | 2;
  decision: 'APPROVE' | 'REJECT';
  opinion: string;
  is_auto?: boolean;
  created_at: string;
}

export interface CompensationRecord {
  id: string;
  ticket_id: string;
  approval_id: string;
  amount: number;
  payment_direction: PaymentDirection;
  status: 'PENDING' | 'SETTLED';
  reconciliation_method: string;
  created_at: string;
}

export interface ScanRecord {
  id: string;
  waybill_code: string;
  sku_code: string;
  sku_name?: string;
  result: 'PASS' | 'FAIL';
  exception_desc?: string;
  batch_lock_state: BatchLockState;
  ticket_id?: string | null;
  operator_id: number;
  operator_name?: string;
  hit_rule_id?: string | null;
  created_at: string;
}

export interface ApiSyncLog {
  id: string;
  request_id: string;
  endpoint: string;
  method: string;
  params_digest: string;
  status_code: number | null;
  duration_ms: number | null;
  success: boolean;
  error_class?: string | null;
  created_at: string;
}
