'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';

interface ExecData {
  compensations: Record<string, unknown>[];
  inventory_changes: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
}

export default function ExecutionPage() {
  const [data, setData] = useState<ExecData | null>(null);

  const load = async () => {
    const res = await fetch('/api/execution');
    const j = await res.json();
    if (j.success) setData(j.data);
  };

  useEffect(() => { load(); }, []);

  if (!data) return <div className="p-6 text-jt-text-secondary">加载中...</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-jt-text">执行联动</h1>
        <p className="text-sm text-jt-text-secondary mt-1">审批通过后的赔付与库存变更 · 全部可反查到触发它的审批记录</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title={`赔付记录（${data.compensations.length}）`}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
              <th className="py-1.5 pr-2">工单</th><th className="py-1.5 pr-2">金额</th><th className="py-1.5 pr-2">方向</th><th className="py-1.5 pr-2">对账方式</th>
            </tr></thead>
            <tbody>
              {data.compensations.map((c) => (
                <tr key={c.id as string} className="border-b border-jt-border">
                  <td className="py-1.5 pr-2 font-mono text-xs">{(c.ticket_no as string) || '—'}</td>
                  <td className="py-1.5 pr-2">¥{c.amount as string}</td>
                  <td className="py-1.5 pr-2">
                    <span className={c.payment_direction === 'CUSTOMER' ? 'text-blue-600' : 'text-amber-600'}>
                      {c.payment_direction === 'CUSTOMER' ? '赔付客户' : '向供应商追偿'}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-xs">{c.reconciliation_method as string}</td>
                </tr>
              ))}
              {data.compensations.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-jt-text-secondary">暂无</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card title={`库存变更（${data.inventory_changes.length}）`}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
              <th className="py-1.5 pr-2">SKU</th><th className="py-1.5 pr-2">变化</th><th className="py-1.5 pr-2">原因</th>
            </tr></thead>
            <tbody>
              {data.inventory_changes.map((c, i) => (
                <tr key={i} className="border-b border-jt-border">
                  <td className="py-1.5 pr-2">{c.sku_code as string}</td>
                  <td className={`py-1.5 pr-2 ${Number(c.delta) > 0 ? 'text-green-600' : 'text-red-500'}`}>{Number(c.delta) > 0 ? '+' : ''}{c.delta as string}</td>
                  <td className="py-1.5 pr-2 text-xs">{c.reason as string}</td>
                </tr>
              ))}
              {data.inventory_changes.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-jt-text-secondary">暂无</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="当前库存（WH01）">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
            <th className="py-1.5 pr-2">SKU</th><th className="py-1.5 pr-2">可用</th><th className="py-1.5 pr-2">锁定</th>
          </tr></thead>
          <tbody>
            {data.inventory.map((c) => (
              <tr key={c.sku_code as string} className="border-b border-jt-border">
                <td className="py-1.5 pr-2">{c.sku_code as string}</td>
                <td className="py-1.5 pr-2">{c.quantity as string}</td>
                <td className="py-1.5 pr-2">{Number(c.locked_qty) > 0 ? <span className="text-amber-600">{c.locked_qty as string}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
