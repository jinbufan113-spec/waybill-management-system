'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Pagination from '@/components/ui/Pagination';

const STATE_LABELS: Record<string, string> = {
  PENDING: '待审批', L1_REVIEWING: '一级审批中', L2_REVIEWING: '二级审批中', EXECUTING: '执行中', COMPLETED: '已完成', CLOSED_REJECTED: '已驳回',
};
const TYPE_LABELS: Record<string, string> = {
  LOST: '丢件', DAMAGED: '破损', REFUSED: '客户拒收', TIMEOUT_UNSIGNED: '超时未签收', WRONG_ADDRESS: '地址错误',
  QTY_MISMATCH: '数量不符', APPEARANCE_DAMAGE: '外观破损', SPEC_MISMATCH: '规格不符', LABEL_ERROR: '标签错误', BATCH_ANOMALY: '批次异常',
};

export default function ApprovalsPage() {
  const [list, setList] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);

  const load = async (p = page) => {
    const res = await fetch(`/api/approvals/pending?page=${p}&limit=${limit}`);
    const j = await res.json();
    if (j.success) { setList(j.data.list); setTotal(j.data.total); setPage(p); }
  };

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-jt-text">待我审批</h1>
        <p className="text-sm text-jt-text-secondary mt-1">按权限范围匹配 · 自批自核被禁止 · 即将超时的工单排在最前</p>
      </div>

      <Card title={`待办（共 ${total} 条）`}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
            <th className="py-2 pr-3">工单号</th><th className="py-2 pr-3">运单号</th><th className="py-2 pr-3">类型</th>
            <th className="py-2 pr-3">来源</th><th className="py-2 pr-3">当前层级</th><th className="py-2 pr-3">金额</th>
            <th className="py-2 pr-3">截止时间</th><th className="py-2 pr-3">上报人</th>
          </tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id as string} className="border-b border-jt-border hover:bg-gray-50">
                <td className="py-2 pr-3">
                  <Link href={`/tickets/${t.id}`} className="text-jt hover:underline font-mono">{t.ticket_no as string}</Link>
                  {t.is_overdue && <span className="ml-1 text-xs text-red-500">[超时]</span>}
                </td>
                <td className="py-2 pr-3">{t.waybill_code as string}</td>
                <td className="py-2 pr-3">{TYPE_LABELS[t.exception_type as string] || t.exception_type}</td>
                <td className="py-2 pr-3">{t.source === 'SCAN' ? '扫描' : '手工'}</td>
                <td className="py-2 pr-3">{t.state === 'L1_REVIEWING' ? '一级' : '二级'}</td>
                <td className="py-2 pr-3">¥{t.amount as string}</td>
                <td className="py-2 pr-3 text-xs">{t.due_at ? new Date(t.due_at as string).toLocaleString() : '—'}</td>
                <td className="py-2 pr-3">{(t.reporter_name as string) || '—'}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-jt-text-secondary">暂无待办</td></tr>}
          </tbody>
        </table>
        <div className="mt-2 flex justify-end">
          <Pagination page={page} total={total} limit={limit} onChange={(p) => load(p)} />
        </div>
      </Card>
    </div>
  );
}
