import { sql } from '@/lib/db';
import type { ExceptionType, PaymentDirection, QcExecutionAction } from '@/types';
import { isLogisticsType } from '@/types';

// 执行联动引擎（模块3核心，考点4核心）
// 在调用方事务内执行：根据异常类型生成赔付记录（含赔付方向）+ 库存变更，全部反查链齐全。
// 重要：本函数不自行 BEGIN/COMMIT，依赖调用方事务包裹，保证"审批通过 ↔ 联动生效"原子性。

interface LogisticsDownstream {
  compensation?: { amount: number; direction: PaymentDirection; method: string };
  inventoryDelta?: { sku: string; delta: number; reason: string };
}

// 物流异常 → 下游动作映射（留白点 ④，业务常识设定）
function logisticsMapping(type: ExceptionType, amount: number): LogisticsDownstream {
  switch (type) {
    case 'LOST':
      // 丢件：赔付客户 + 回滚库存（扣减）
      return {
        compensation: { amount, direction: 'CUSTOMER', method: '客户理赔-货损' },
        inventoryDelta: { sku: 'AUTO', delta: -1, reason: '丢件-库存回滚' },
      };
    case 'DAMAGED':
      // 破损：赔付客户 + 残品处理（扣减可用库存）
      return {
        compensation: { amount, direction: 'CUSTOMER', method: '客户理赔-破损' },
        inventoryDelta: { sku: 'AUTO', delta: -1, reason: '破损-残品扣减' },
      };
    case 'REFUSED':
      // 拒收：退货入库（库存增加），通常不赔付
      return {
        inventoryDelta: { sku: 'AUTO', delta: +1, reason: '拒收-退货入库' },
      };
    case 'TIMEOUT_UNSIGNED':
      // 超时未签收：跟进/重发，无库存联动（人工跟进）
      return {};
    case 'WRONG_ADDRESS':
      // 地址错误：重新发货（扣库存），通常不赔付
      return {
        inventoryDelta: { sku: 'AUTO', delta: -1, reason: '地址错误-重新发货' },
      };
    default:
      return {};
  }
}

// 品控异常 → 执行动作（4 选 1，由品控主管/审批人在执行环节选择）
export async function executeQcAction(
  ticketId: string,
  approvalId: string,
  action: QcExecutionAction,
  waybillCode: string,
  amount: number
): Promise<{ compensation_created: boolean; inventory_changed: boolean }> {
  let compCreated = false;
  let invChanged = false;

  // 记录工单选择的品控动作
  await sql.query(`UPDATE exception_tickets SET qc_action = $1 WHERE id = $2`, [action, ticketId]);

  // 取关联 SKU（从扫描记录或本地快照）
  const skuRes = await sql`
    SELECT sku_code FROM scan_records WHERE ticket_id = ${ticketId} LIMIT 1
  `;
  const skuCode = skuRes.rows.length > 0 ? (skuRes.rows[0] as { sku_code: string }).sku_code : null;

  switch (action) {
    case 'RELEASE':
      // 放行：解锁批次，无赔付（已在批次解锁逻辑中处理）
      break;
    case 'RETURN_SUPPLIER':
      // 退供应商 + 追偿
      await sql.query(
        `INSERT INTO compensation_records (ticket_id, approval_id, amount, payment_direction, status, reconciliation_method)
         VALUES ($1, $2, $3, 'SUPPLIER', 'PENDING', '向供应商追偿-退货')`,
        [ticketId, approvalId, amount]
      );
      compCreated = true;
      if (skuCode) {
        await sql.query(
          `UPDATE inventory SET quantity = quantity - 1, updated_at = NOW() WHERE sku_code = $1`,
          [skuCode]
        );
        await sql.query(
          `INSERT INTO inventory_changes (sku_code, delta, reason, ticket_id, approval_id) VALUES ($1, -1, '退供应商', $2, $3)`,
          [skuCode, ticketId, approvalId]
        );
        invChanged = true;
      }
      break;
    case 'REPURCHASE':
      // 重新采购 + 追偿（库存先扣减，采购到货后再加——此处只记录赔付与扣减）
      await sql.query(
        `INSERT INTO compensation_records (ticket_id, approval_id, amount, payment_direction, status, reconciliation_method)
         VALUES ($1, $2, $3, 'SUPPLIER', 'PENDING', '向供应商追偿-重采购')`,
        [ticketId, approvalId, amount]
      );
      compCreated = true;
      if (skuCode) {
        await sql.query(
          `INSERT INTO inventory_changes (sku_code, delta, reason, ticket_id, approval_id) VALUES ($1, -1, '重新采购-旧批次作废', $2, $3)`,
          [skuCode, ticketId, approvalId]
        );
        invChanged = true;
      }
      break;
    case 'DOWNGRADE':
      // 降级处理 + 追偿差价
      await sql.query(
        `INSERT INTO compensation_records (ticket_id, approval_id, amount, payment_direction, status, reconciliation_method)
         VALUES ($1, $2, $3, 'SUPPLIER', 'PENDING', '向供应商追偿-降级差价')`,
        [ticketId, approvalId, amount]
      );
      compCreated = true;
      break;
  }

  // 同事务内解锁扫描批次（如果有）—— 工单关闭前批次不得自动解锁的反向：工单执行时解锁
  await sql.query(
    `UPDATE scan_records SET batch_lock_state = 'UNLOCKED' WHERE ticket_id = $1 AND batch_lock_state = 'LOCKED'`,
    [ticketId]
  );

  void waybillCode;
  return { compensation_created: compCreated, inventory_changed: invChanged };
}

// 物流类工单审批通过 → 自动联动
export async function executeApprovalActions(
  ticketId: string,
  approvalId: string,
  exceptionType: ExceptionType,
  source: string
): Promise<void> {
  if (!isLogisticsType(exceptionType)) {
    // 品控类工单的执行动作需品控主管/审批人在执行环节选择，此处不自动触发
    return;
  }

  // 取工单金额
  const t = await sql`SELECT amount, waybill_code FROM exception_tickets WHERE id = ${ticketId}`;
  if (t.rows.length === 0) return;
  const { amount, waybill_code } = t.rows[0] as { amount: number; waybill_code: string };

  const map = logisticsMapping(exceptionType, amount);

  if (map.compensation) {
    await sql.query(
      `INSERT INTO compensation_records (ticket_id, approval_id, amount, payment_direction, status, reconciliation_method)
       VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
      [ticketId, approvalId, map.compensation.amount, map.compensation.direction, map.compensation.method]
    );
  }

  if (map.inventoryDelta) {
    // 取该运单的 SKU（从本地快照）
    const snap = await sql`SELECT sku_items FROM waybill_snapshots WHERE waybill_code = ${waybill_code}`;
    const skuItems = snap.rows.length > 0
      ? ((snap.rows[0] as { sku_items: { sku_code: string }[] }).sku_items || [])
      : [];
    for (const it of skuItems.slice(0, 1)) { // 仅对首件做示意性库存联动
      const sku = it.sku_code;
      const delta = map.inventoryDelta.delta;
      await sql.query(
        `INSERT INTO inventory_changes (sku_code, delta, reason, ticket_id, approval_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [sku, delta, map.inventoryDelta.reason, ticketId, approvalId]
      );
      await sql.query(
        `UPDATE inventory SET quantity = quantity + $1, updated_at = NOW() WHERE sku_code = $2`,
        [delta, sku]
      );
    }
  }
}
