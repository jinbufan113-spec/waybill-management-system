import { sql } from './db';

// V3 独立数据库建表 + 索引 + 种子数据（角色、用户、系统配置、品控规则、示例库存）
// 可重入：CREATE TABLE IF NOT EXISTS / ON CONFLICT。
export async function initDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(64) NOT NULL,
      description TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      username VARCHAR(64) UNIQUE NOT NULL,
      password_hash VARCHAR(128) NOT NULL DEFAULT 'demo',
      warehouse_id VARCHAR(32),
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    )
  `;

  // V2 运单只读快照（V3 自有，不直连 V2 库）
  await sql`
    CREATE TABLE IF NOT EXISTS waybill_snapshots (
      waybill_code VARCHAR(64) PRIMARY KEY,
      store_name VARCHAR(100),
      receiver_name VARCHAR(64),
      receiver_phone VARCHAR(32),
      receiver_address VARCHAR(255),
      amount NUMERIC(14,2),
      sku_items JSONB,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source VARCHAR(16) NOT NULL DEFAULT 'SYNC'
    )
  `;

  // 跨系统接口同步日志（Request-Id 全链路）
  await sql`
    CREATE TABLE IF NOT EXISTS api_sync_logs (
      id BIGSERIAL PRIMARY KEY,
      request_id VARCHAR(80) NOT NULL,
      endpoint VARCHAR(200) NOT NULL,
      method VARCHAR(10) NOT NULL,
      params_digest VARCHAR(300),
      status_code INT,
      duration_ms INT,
      success BOOLEAN NOT NULL,
      error_class VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_sync_logs(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_logs_request_id ON api_sync_logs(request_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_sync_logs(endpoint)`;

  // 异常工单
  await sql`
    CREATE TABLE IF NOT EXISTS exception_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_no VARCHAR(32) UNIQUE NOT NULL,
      waybill_code VARCHAR(64) NOT NULL,
      exception_type VARCHAR(32) NOT NULL,
      source VARCHAR(16) NOT NULL,
      state VARCHAR(24) NOT NULL,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      description TEXT,
      reporter_id INT NOT NULL REFERENCES users(id),
      current_approver_id INT REFERENCES users(id),
      resubmit_count INT NOT NULL DEFAULT 0,
      version INT NOT NULL DEFAULT 1,
      due_at TIMESTAMPTZ,
      batch_id VARCHAR(64),
      warehouse_id VARCHAR(32),
      qc_action VARCHAR(32),
      ai_suggestion JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_state ON exception_tickets(state)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_waybill ON exception_tickets(waybill_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_source_type ON exception_tickets(source, exception_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_approver ON exception_tickets(current_approver_id) WHERE current_approver_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_due ON exception_tickets(due_at) WHERE state IN ('PENDING','L1_REVIEWING','L2_REVIEWING')`;

  // 审批记录（反查链核心）
  await sql`
    CREATE TABLE IF NOT EXISTS approval_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES exception_tickets(id) ON DELETE CASCADE,
      approver_id INT NOT NULL REFERENCES users(id),
      approver_name VARCHAR(64),
      level SMALLINT NOT NULL,
      decision VARCHAR(16) NOT NULL,
      opinion TEXT,
      is_auto BOOLEAN NOT NULL DEFAULT FALSE,
      idempotency_key VARCHAR(80) UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_approval_ticket ON approval_records(ticket_id, created_at)`;

  // 赔付记录（含赔付方向字段，品控追偿 vs 客户理赔）
  await sql`
    CREATE TABLE IF NOT EXISTS compensation_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES exception_tickets(id) ON DELETE CASCADE,
      approval_id UUID NOT NULL REFERENCES approval_records(id) ON DELETE CASCADE,
      amount NUMERIC(14,2) NOT NULL,
      payment_direction VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
      reconciliation_method VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_comp_ticket ON compensation_records(ticket_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_comp_approval ON compensation_records(approval_id)`;

  // 库存 + 库存变更（变更记录关联 approval_id，可追溯）
  await sql`
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      sku_code VARCHAR(64) NOT NULL,
      warehouse_id VARCHAR(32) NOT NULL DEFAULT 'WH01',
      quantity INT NOT NULL DEFAULT 0,
      locked_qty INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (sku_code, warehouse_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS inventory_changes (
      id BIGSERIAL PRIMARY KEY,
      sku_code VARCHAR(64) NOT NULL,
      warehouse_id VARCHAR(32) NOT NULL DEFAULT 'WH01',
      delta INT NOT NULL,
      reason VARCHAR(64),
      ticket_id UUID,
      approval_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_inv_change_sku ON inventory_changes(sku_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_inv_change_approval ON inventory_changes(approval_id)`;

  // 扫描记录（与工单表分离，通过 ticket_id 关联，1:N）
  await sql`
    CREATE TABLE IF NOT EXISTS scan_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      waybill_code VARCHAR(64) NOT NULL,
      sku_code VARCHAR(64) NOT NULL,
      sku_name VARCHAR(100),
      result VARCHAR(8) NOT NULL,
      exception_desc TEXT,
      batch_lock_state VARCHAR(16) NOT NULL DEFAULT 'UNLOCKED',
      ticket_id UUID REFERENCES exception_tickets(id) ON DELETE SET NULL,
      hit_rule_id UUID,
      operator_id INT NOT NULL REFERENCES users(id),
      operator_name VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_waybill_sku ON scan_records(waybill_code, sku_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_ticket ON scan_records(ticket_id)`;

  // 品控规则（可配置，不硬编码触发条件）
  await sql`
    CREATE TABLE IF NOT EXISTS qc_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sub_type VARCHAR(32) NOT NULL,
      name VARCHAR(100) NOT NULL,
      conditions JSONB NOT NULL,
      severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
      auto_create_ticket BOOLEAN NOT NULL DEFAULT TRUE,
      auto_level SMALLINT NOT NULL DEFAULT 2,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // 系统配置（可配置阈值，后台可调）
  await sql`
    CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(64) PRIMARY KEY,
      value JSONB NOT NULL,
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log('V3 database tables initialized');
}

export async function seedDatabase() {
  // 角色
  const roles = [
    ['reporter', '上报人', '可发起异常上报'],
    ['approver_l1', '一级审批人', '一级审批'],
    ['approver_l2', '二级审批人', '一/二级审批'],
    ['qc_supervisor', '品控主管', '审批 + 误判快速放行 + 后台配置'],
  ];
  for (const [code, name, desc] of roles) {
    await sql`
      INSERT INTO roles (code, name, description)
      VALUES (${code}, ${name}, ${desc})
      ON CONFLICT (code) DO NOTHING
    `;
  }

  // 用户（演示账号，密码一律 demo123）
  const users: Array<[string, string, string[]]> = [
    ['张上报', 'reporter', ['reporter']],
    ['李一审', 'l1', ['approver_l1']],
    ['王二审', 'l2', ['approver_l2']],
    ['钱品控', 'qc', ['qc_supervisor']],
  ];
  for (const [name, username, roleCodes] of users) {
    const inserted = await sql`
      INSERT INTO users (name, username, password_hash, warehouse_id)
      VALUES (${name}, ${username}, 'demo123', 'WH01')
      ON CONFLICT (username) DO NOTHING
      RETURNING id
    `;
    let uid = inserted.rows.length > 0 ? (inserted.rows[0] as { id: number }).id : null;
    if (uid === null) {
      const found = await sql`SELECT id FROM users WHERE username = ${username}`;
      uid = (found.rows[0] as { id: number }).id;
    }
    for (const code of roleCodes) {
      await sql`
        INSERT INTO user_roles (user_id, role_id)
        SELECT ${uid}, id FROM roles WHERE code = ${code}
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // 系统配置（覆盖 9 项留白中可量化的部分）
  const configs: [string, unknown, string][] = [
    ['L1_THRESHOLD', 500, '一级审批金额阈值（元），超过则升级二级'],
    ['APPROVAL_TIMEOUT_HOURS', 24, '审批超时时长（小时），超时自动升级/驳回'],
    ['MAX_RESUBMIT', 3, '拒绝后允许重新提交次数上限'],
    ['QC_HOLD_TIMEOUT_HOURS', 2, '品控暂扣超时（小时），独立于审批超时，应远短于审批超时（压仓成本）'],
    ['SYNC_INTERVAL_MINUTES', 10, '本地快照增量同步间隔（分钟）'],
    ['L1_TIMEOUT_ACTION', 'ESCALATE_L2', '一级超时动作：升级二级'],
    ['L2_TIMEOUT_ACTION', 'AUTO_REJECT', '二级超时动作：自动驳回（兜底）'],
    ['QC_QTY_DIFF_THRESHOLD', 0.05, '品控规则：数量差异超过此比例判定异常'],
    ['QC_SPEC_DIFF_THRESHOLD', 0.10, '品控规则：规格偏差超过此比例判定异常'],
  ];
  for (const [key, value, desc] of configs) {
    const valueStr = JSON.stringify(value);
    await sql`
      INSERT INTO system_config (key, value, description)
      VALUES (${key}, ${valueStr}::jsonb, ${desc})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description
    `;
  }

  // 品控规则（可配置触发条件，不硬编码）
  const qcRules: [string, string, Record<string, unknown>, string, number][] = [
    ['QTY_MISMATCH', '数量不符（差异>5%）', { field: 'quantity_diff_ratio', op: '>', threshold: 0.05 }, 'MEDIUM', 2],
    ['APPEARANCE_DAMAGE', '外观破损（中等及以上）', { field: 'damage_level', op: '>=', values: ['MEDIUM', 'SEVERE'] }, 'HIGH', 2],
    ['SPEC_MISMATCH', '规格不符（偏差>10%）', { field: 'spec_diff_ratio', op: '>', threshold: 0.10 }, 'MEDIUM', 2],
    ['LABEL_ERROR', '标签错误（编码不匹配）', { field: 'label_match', op: '==', value: false }, 'MEDIUM', 2],
    ['BATCH_ANOMALY', '批次异常', { field: 'batch_anomaly', op: '==', value: true }, 'HIGH', 2],
  ];
  for (const [subType, name, conditions, severity, level] of qcRules) {
    const condStr = JSON.stringify(conditions);
    await sql`
      INSERT INTO qc_rules (sub_type, name, conditions, severity, auto_create_ticket, auto_level, enabled)
      VALUES (${subType}, ${name}, ${condStr}::jsonb, ${severity}, TRUE, ${level}, TRUE)
      ON CONFLICT DO NOTHING
    `;
  }

  // 示例库存（WH01 仓库）
  const sampleSkus = [
    ['SKU-1001', 120],
    ['SKU-1002', 80],
    ['SKU-1003', 200],
    ['SKU-1004', 60],
    ['SKU-1005', 150],
    ['SKU-1006', 40],
    ['SKU-1007', 35],
    ['SKU-1008', 90],
  ];
  for (const [sku, qty] of sampleSkus) {
    await sql`
      INSERT INTO inventory (sku_code, warehouse_id, quantity, locked_qty)
      VALUES (${sku}, 'WH01', ${qty}, 0)
      ON CONFLICT (sku_code, warehouse_id) DO NOTHING
    `;
  }

  console.log('V3 seed data inserted');
}
