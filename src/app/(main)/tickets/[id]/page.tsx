import { sql } from '@/lib/db';
import Card from '@/components/ui/Card';
import TicketActions from './TicketActions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  PENDING: '待审批', L1_REVIEWING: '一级审批中', L2_REVIEWING: '二级审批中',
  EXECUTING: '执行中', COMPLETED: '已完成', CLOSED_REJECTED: '已驳回',
};
const TYPE_LABELS: Record<string, string> = {
  LOST: '丢件', DAMAGED: '破损', REFUSED: '客户拒收', TIMEOUT_UNSIGNED: '超时未签收', WRONG_ADDRESS: '地址错误',
  QTY_MISMATCH: '数量不符', APPEARANCE_DAMAGE: '外观破损', SPEC_MISMATCH: '规格不符', LABEL_ERROR: '标签错误', BATCH_ANOMALY: '批次异常',
};

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let ticket: Record<string, any> | null = null;
  let approvals: Record<string, any>[] = [];
  let compensations: Record<string, any>[] = [];
  let scans: Record<string, any>[] = [];
  let invChanges: Record<string, any>[] = [];
  let waybillInfo: { data: any; source: string; synced_at?: string | null; request_id?: string } | null = null;

  try {
    const tRes = await sql`
      SELECT t.*, u.name AS reporter_name FROM exception_tickets t LEFT JOIN users u ON u.id = t.reporter_id WHERE t.id = ${id}
    `;
    if (tRes.rows.length === 0) {
      return <div className="p-6"><Card title="工单不存在"><Link href="/tickets" className="text-jt hover:underline">返回列表</Link></Card></div>;
    }
    ticket = tRes.rows[0];

    const [a, c, s, ic] = await Promise.all([
      sql`SELECT ar.*, u.name AS approver_name FROM approval_records ar LEFT JOIN users u ON u.id = ar.approver_id WHERE ar.ticket_id = ${id} ORDER BY ar.created_at ASC`,
      sql`SELECT * FROM compensation_records WHERE ticket_id = ${id} ORDER BY created_at ASC`,
      sql`SELECT sc.*, u.name AS operator_name FROM scan_records sc LEFT JOIN users u ON u.id = sc.operator_id WHERE sc.ticket_id = ${id} ORDER BY sc.created_at ASC`,
      sql`SELECT * FROM inventory_changes WHERE ticket_id = ${id} ORDER BY created_at ASC`,
    ]);
    approvals = a.rows; compensations = c.rows; scans = s.rows; invChanges = ic.rows;

    // 运单信息：尝试本地快照（详情页服务端不再实时调 V2，由前端按需实时刷新；这里给缓存视图）
    const wbCode = ticket.waybill_code as string;
    const snap = await sql`SELECT * FROM waybill_snapshots WHERE waybill_code = ${wbCode}`;
    if (snap.rows.length > 0) {
      waybillInfo = { data: snap.rows[0], source: 'CACHE', synced_at: (snap.rows[0] as { synced_at: string }).synced_at };
    }
  } catch {
    return <div className="p-6"><Card title="加载失败">数据库未初始化或查询出错</Card></div>;
  }

  const t = ticket!;
  const isQc = (t.source as string) === 'SCAN';
  const isOverdue = t.due_at && new Date(t.due_at as string) < new Date() && ['PENDING', 'L1_REVIEWING', 'L2_REVIEWING'].includes(t.state as string);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/tickets" className="text-xs text-jt-text-secondary hover:text-jt">← 返回列表</Link>
          <h1 className="text-xl font-bold text-jt-text mt-1 flex items-center gap-2">
            {t.ticket_no as string}
            {isOverdue && <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded">即将超时</span>}
          </h1>
        </div>
        <TicketActions ticket={t} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="工单基本信息">
          <dl className="text-sm space-y-2">
            <Row label="运单号" value={t.waybill_code as string} />
            <Row label="异常类型" value={TYPE_LABELS[t.exception_type as string] || (t.exception_type as string)} />
            <Row label="来源" value={t.source === 'SCAN' ? '扫描自动触发' : '手工上报'} />
            <Row label="状态" value={STATE_LABELS[t.state as string] || (t.state as string)} />
            <Row label="金额" value={`¥${t.amount}`} />
            <Row label="上报人" value={(t.reporter_name as string) || '—'} />
            <Row label="创建时间" value={new Date(t.created_at as string).toLocaleString()} />
            {t.due_at && <Row label="截止时间" value={new Date(t.due_at as string).toLocaleString()} />}
            {isQc && t.qc_action && <Row label="品控动作" value={t.qc_action as string} />}
            {t.description && <Row label="描述" value={t.description as string} />}
          </dl>
        </Card>

        <Card title="关联运单信息（数据来源标注）">
          {waybillInfo ? (
            <div>
              <div className="mb-2">
                {waybillInfo.source === 'REALTIME' ? (
                  <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">● 实时获取自 V2</span>
                ) : (
                  <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                    ⚠ 使用本地缓存，同步于 {waybillInfo.synced_at ? new Date(waybillInfo.synced_at).toLocaleString() : '未知'}
                  </span>
                )}
              </div>
              <WaybillInfo data={waybillInfo.data as Record<string, unknown>} />
            </div>
          ) : (
            <div className="text-sm text-jt-text-secondary">本地无缓存，请前往 <Link href="/monitor" className="text-jt">接口监控</Link> 同步运单</div>
          )}
        </Card>
      </div>

      <Card title="审批历史（审计日志）">
        {approvals.length === 0 ? (
          <div className="text-sm text-jt-text-secondary">暂无审批记录</div>
        ) : (
          <div className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id as string} className="flex items-start gap-3 p-2 border-l-2 border-jt pl-3">
                <div className="flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{(a.approver_name as string) || '系统'}</span>
                    <span className="text-jt-text-secondary mx-1">·</span>
                    <span className={a.decision === 'APPROVE' ? 'text-green-600' : 'text-red-500'}>
                      {a.decision === 'APPROVE' ? '通过' : '拒绝'}
                    </span>
                    <span className="text-jt-text-secondary mx-1">·</span>
                    <span className="text-xs">L{a.level as number}</span>
                    {a.is_auto && <span className="ml-1 text-xs text-amber-600">[系统自动]</span>}
                  </div>
                  {a.opinion && <div className="text-xs text-jt-text-secondary mt-0.5">{a.opinion as string}</div>}
                </div>
                <div className="text-xs text-jt-text-secondary whitespace-nowrap">{new Date(a.created_at as string).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {(compensations.length > 0 || invChanges.length > 0) && (
        <Card title="执行联动（赔付 / 库存变更 · 可追溯）">
          {compensations.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-jt-text-secondary mb-1">赔付记录</div>
              {compensations.map((c) => (
                <div key={c.id as string} className="text-sm flex justify-between border-b border-jt-border py-1">
                  <span>
                    ¥{c.amount as string} · {c.payment_direction === 'CUSTOMER' ? '赔付客户' : '向供应商追偿'}
                    <span className="text-jt-text-secondary ml-2">({c.reconciliation_method as string})</span>
                  </span>
                  <span className="text-xs text-jt-text-secondary">approval: {(c.approval_id as string)?.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          )}
          {invChanges.length > 0 && (
            <div>
              <div className="text-xs text-jt-text-secondary mb-1">库存变更</div>
              {invChanges.map((ic, idx) => (
                <div key={idx} className="text-sm flex justify-between border-b border-jt-border py-1">
                  <span>{ic.sku_code as string} <span className={Number(ic.delta) > 0 ? 'text-green-600' : 'text-red-500'}>{Number(ic.delta) > 0 ? '+' : ''}{ic.delta as string}</span> · {ic.reason as string}</span>
                  <span className="text-xs text-jt-text-secondary">approval: {(ic.approval_id as string)?.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {scans.length > 0 && (
        <Card title="关联扫描记录（批次状态）">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
              <th className="py-2 pr-3">SKU</th><th className="py-2 pr-3">结果</th><th className="py-2 pr-3">批次状态</th><th className="py-2 pr-3">操作人</th><th className="py-2 pr-3">时间</th>
            </tr></thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id as string} className="border-b border-jt-border">
                  <td className="py-2 pr-3">{s.sku_code as string}</td>
                  <td className="py-2 pr-3">{s.result === 'PASS' ? <span className="text-green-600">通过</span> : <span className="text-red-500">异常</span>}</td>
                  <td className="py-2 pr-3">{s.batch_lock_state === 'LOCKED' ? <span className="text-amber-600">锁定</span> : <span className="text-jt-text-secondary">已解锁</span>}</td>
                  <td className="py-2 pr-3">{(s.operator_name as string) || '—'}</td>
                  <td className="py-2 pr-3 text-xs text-jt-text-secondary">{new Date(s.created_at as string).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-jt-text-secondary">{label}</dt><dd className="font-medium text-right">{value}</dd></div>;
}

function WaybillInfo({ data }: { data: Record<string, any> }) {
  const items = (data.sku_items as { sku_code: string; sku_name: string; sku_quantity: number }[]) || [];
  return (
    <dl className="text-sm space-y-2">
      <Row label="门店" value={(data.store_name as string) || '—'} />
      <Row label="收件人" value={`${data.receiver_name || '—'} / ${data.receiver_phone || '—'}`} />
      <Row label="地址" value={(data.receiver_address as string) || '—'} />
      <Row label="金额" value={`¥${data.amount ?? '—'}`} />
      <div>
        <dt className="text-jt-text-secondary mb-1">SKU 明细</dt>
        <dd>
          {items.length === 0 ? <span className="text-xs">—</span> : (
            <div className="space-y-1">
              {items.map((it, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1">{it.sku_code} {it.sku_name} × {it.sku_quantity}</div>
              ))}
            </div>
          )}
        </dd>
      </div>
    </dl>
  );
}
