import { sql } from '@/lib/db';
import Card from '@/components/ui/Card';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let stats = {
    pending: 0, l1: 0, l2: 0, executing: 0, completed: 0, rejected: 0, total: 0,
    scanTickets: 0, manualTickets: 0,
    lastSync: null as string | null, syncSuccessRate: 0,
  };
  let dbReady = true;
  try {
    const s = await sql`
      SELECT
        COUNT(*) FILTER (WHERE state='PENDING') AS pending,
        COUNT(*) FILTER (WHERE state='L1_REVIEWING') AS l1,
        COUNT(*) FILTER (WHERE state='L2_REVIEWING') AS l2,
        COUNT(*) FILTER (WHERE state='EXECUTING') AS executing,
        COUNT(*) FILTER (WHERE state='COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE state='CLOSED_REJECTED') AS rejected,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE source='SCAN') AS scan_tickets,
        COUNT(*) FILTER (WHERE source='MANUAL') AS manual_tickets
      FROM exception_tickets
    `;
    const row = s.rows[0] as Record<string, string>;
    stats = {
      pending: Number(row.pending), l1: Number(row.l1), l2: Number(row.l2),
      executing: Number(row.executing), completed: Number(row.completed),
      rejected: Number(row.rejected), total: Number(row.total),
      scanTickets: Number(row.scan_tickets), manualTickets: Number(row.manual_tickets),
      lastSync: null, syncSuccessRate: 0,
    };
    const sync = await sql`
      SELECT
        (SELECT created_at FROM api_sync_logs ORDER BY created_at DESC LIMIT 1) AS last_sync,
        (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE success) / NULLIF(COUNT(*),0), 1)
           FROM api_sync_logs WHERE created_at > NOW() - INTERVAL '24 hours') AS rate
    `;
    const sr = sync.rows[0] as { last_sync: string | null; rate: number | null };
    stats.lastSync = sr.last_sync;
    stats.syncSuccessRate = sr.rate ?? 0;
  } catch {
    dbReady = false;
  }

  if (!dbReady) {
    return (
      <div className="p-6">
        <Card title="数据库未初始化">
          <p className="text-sm text-jt-text-secondary mb-3">
            检测到 V3 数据库表尚未创建。请先初始化（含种子数据）：
          </p>
          <div className="flex gap-2">
            <Link href="/api/init-db?seed=1" className="px-4 py-2 bg-jt text-white rounded text-sm hover:bg-jt-dark">
              一键初始化（建表 + 种子）
            </Link>
            <Link href="/api/init-db" className="px-4 py-2 bg-gray-100 text-jt-text rounded text-sm hover:bg-gray-200">
              仅建表（不灌种子）
            </Link>
          </div>
          <p className="text-xs text-jt-text-secondary mt-3">
            初始化后再刷新本页。演示账号：reporter / l1 / l2 / qc，密码均为 demo123。
          </p>
        </Card>
      </div>
    );
  }

  const cards = [
    { label: '待审批', value: stats.pending, color: 'text-gray-700', href: '/tickets?state=PENDING' },
    { label: '一级审批中', value: stats.l1, color: 'text-blue-600', href: '/tickets?state=L1_REVIEWING' },
    { label: '二级审批中', value: stats.l2, color: 'text-amber-600', href: '/tickets?state=L2_REVIEWING' },
    { label: '执行中', value: stats.executing, color: 'text-purple-600', href: '/tickets?state=EXECUTING' },
    { label: '已完成', value: stats.completed, color: 'text-green-600', href: '/tickets?state=COMPLETED' },
    { label: '已驳回', value: stats.rejected, color: 'text-red-500', href: '/tickets?state=CLOSED_REJECTED' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-jt-text">工作台</h1>
        <p className="text-sm text-jt-text-secondary mt-1">运单全生命周期管理 · 扫描品控 → 异常上报 → 分级审批 → 执行联动</p>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-jt-text-secondary mt-1">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="工单来源分布">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-jt-text-secondary">手工上报（物流异常）</span><span className="font-medium">{stats.manualTickets}</span></div>
            <div className="flex justify-between"><span className="text-jt-text-secondary">扫描触发（品控异常）</span><span className="font-medium">{stats.scanTickets}</span></div>
            <div className="flex justify-between pt-2 border-t border-jt-border"><span className="text-jt-text-secondary">合计</span><span className="font-bold">{stats.total}</span></div>
          </div>
        </Card>
        <Card title="跨系统接口同步">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-jt-text-secondary">最近一次同步</span><span className="font-medium">{stats.lastSync ? new Date(stats.lastSync as string).toLocaleString() : '—'}</span></div>
            <div className="flex justify-between"><span className="text-jt-text-secondary">24h 成功率</span><span className="font-medium">{stats.syncSuccessRate}%</span></div>
            <Link href="/monitor" className="block text-jt text-xs mt-2 hover:underline">查看接口监控 →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
