import { sql } from '@/lib/db';
import { getConfigNumber, getConfigString, computeDueAt } from '@/lib/approval-engine';

// 超时自动流转 worker：扫描所有超时未处理的工单，按配置升级或驳回。
// 触发方式：Vercel Cron + 手动 API 调用（/api/cron/timeout）。
// 幂等性：基于工单当前状态做前置校验，只在状态合法时更新。

interface WorkerStats {
  escalated_l2: number;
  auto_rejected: number;
  qc_force_escalated: number;
  errors: number;
}

export async function runTimeoutWorker(): Promise<WorkerStats> {
  const stats: WorkerStats = { escalated_l2: 0, auto_rejected: 0, qc_force_escalated: 0, errors: 0 };
  const maxResubmit = await getConfigNumber('MAX_RESUBMIT');
  const l2Action = await getConfigString('L2_TIMEOUT_ACTION');

  // 1) 一级审批中超时 → 升级到二级
  const l1Timeout = await sql`
    SELECT id, version FROM exception_tickets
     WHERE state = 'L1_REVIEWING' AND due_at IS NOT NULL AND due_at < NOW()
       AND source = 'MANUAL'
  `;
  for (const row of l1Timeout.rows as { id: string; version: number }[]) {
    try {
      const due = await computeDueAt('L2_REVIEWING');
      const dueIso = due ? due.toISOString() : null;
      const r = await sql`
        UPDATE exception_tickets
           SET state = 'L2_REVIEWING', due_at = ${dueIso}, updated_at = NOW(), version = version + 1
         WHERE id = ${row.id} AND version = ${row.version} AND state = 'L1_REVIEWING'
         RETURNING id
      `;
      if (r.rows.length > 0) {
        stats.escalated_l2++;
        await sql`
          INSERT INTO approval_records (ticket_id, approver_id, approver_name, level, decision, opinion, is_auto)
          SELECT ${row.id}, id, '系统超时流转', 2, 'APPROVE', '一级审批超时，系统自动升级二级', TRUE FROM users WHERE username = 'l2' LIMIT 1
        `;
      }
    } catch {
      stats.errors++;
    }
  }

  // 2) 二级审批中超时 → 按配置（默认自动驳回）
  const l2Timeout = await sql`
    SELECT id, version FROM exception_tickets
     WHERE state = 'L2_REVIEWING' AND due_at IS NOT NULL AND due_at < NOW()
  `;
  for (const row of l2Timeout.rows as { id: string; version: number }[]) {
    try {
      if (l2Action === 'AUTO_REJECT') {
        const r = await sql`
          UPDATE exception_tickets
             SET state = 'CLOSED_REJECTED', due_at = NULL, updated_at = NOW(), version = version + 1
           WHERE id = ${row.id} AND version = ${row.version} AND state = 'L2_REVIEWING'
           RETURNING id
        `;
        if (r.rows.length > 0) {
          stats.auto_rejected++;
          await sql`
            INSERT INTO approval_records (ticket_id, approver_id, approver_name, level, decision, opinion, is_auto)
            SELECT ${row.id}, id, '系统超时流转', 2, 'REJECT', '二级审批超时，系统自动驳回（兜底）', TRUE FROM users WHERE username = 'l2' LIMIT 1
          `;
        }
      }
    } catch {
      stats.errors++;
    }
  }

  // 3) 品控暂扣批次超时（batch_id 锁定且工单在二级）→ 强制升级（已在二级，记一条告警审批记录）
  // 这里以品控类工单在二级审批超时统一进自动驳回处理；如需独立的"强制升级"分支可在配置中扩展。
  void maxResubmit;

  return stats;
}
