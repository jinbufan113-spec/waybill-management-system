'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';

const STATE_LABELS: Record<string, string> = {
  PENDING: '待审批', L1_REVIEWING: '一级审批中', L2_REVIEWING: '二级审批中',
  EXECUTING: '执行中', COMPLETED: '已完成', CLOSED_REJECTED: '已驳回',
};
const STATE_COLORS: Record<string, string> = {
  PENDING: 'text-gray-600', L1_REVIEWING: 'text-blue-600', L2_REVIEWING: 'text-amber-600',
  EXECUTING: 'text-purple-600', COMPLETED: 'text-green-600', CLOSED_REJECTED: 'text-red-500',
};
const TYPE_LABELS: Record<string, string> = {
  LOST: '丢件', DAMAGED: '破损', REFUSED: '客户拒收', TIMEOUT_UNSIGNED: '超时未签收', WRONG_ADDRESS: '地址错误',
  QTY_MISMATCH: '数量不符', APPEARANCE_DAMAGE: '外观破损', SPEC_MISMATCH: '规格不符', LABEL_ERROR: '标签错误', BATCH_ANOMALY: '批次异常',
};

export default function TicketsPage() {
  const { toast } = useToast();
  const [list, setList] = useState<Record<string, any>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [filters, setFilters] = useState({ state: '', type: '', source: '', q: '' });
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = async (p = page) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (filters.state) params.set('state', filters.state);
    if (filters.type) params.set('type', filters.type);
    if (filters.source) params.set('source', filters.source);
    if (filters.q) params.set('q', filters.q);
    const res = await fetch(`/api/tickets?${params}`);
    const j = await res.json();
    if (j.success) { setList(j.data.list); setTotal(j.data.total); setPage(p); }
    setLoading(false);
  };

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);

  const submitSearch = () => load(1);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-jt-text">异常工单</h1>
          <p className="text-sm text-jt-text-secondary mt-1">物流异常（手工上报）与品控异常（扫描触发）统一管理</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ 上报异常</Button>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input label="搜索" value={filters.q} onChange={(e) => setFilters({ ...filters, q: (e.target as HTMLInputElement).value })} placeholder="工单号 / 运单号" />
          </div>
          <div className="w-[150px]">
            <label className="block text-xs text-jt-text-secondary mb-1">状态</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
              <option value="">全部</option>
              {Object.entries(STATE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="w-[150px]">
            <label className="block text-xs text-jt-text-secondary mb-1">类型</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">全部</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="w-[140px]">
            <label className="block text-xs text-jt-text-secondary mb-1">来源</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
              <option value="">全部</option>
              <option value="MANUAL">手工上报</option>
              <option value="SCAN">扫描触发</option>
            </select>
          </div>
          <Button onClick={submitSearch}>查询</Button>
        </div>
      </Card>

      <Card title={`工单列表（共 ${total} 条）`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
                <th className="py-2 pr-3">工单号</th>
                <th className="py-2 pr-3">运单号</th>
                <th className="py-2 pr-3">类型</th>
                <th className="py-2 pr-3">来源</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">金额</th>
                <th className="py-2 pr-3">上报人</th>
                <th className="py-2 pr-3">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id as string} className="border-b border-jt-border hover:bg-gray-50">
                  <td className="py-2 pr-3">
                    <Link href={`/tickets/${t.id}`} className="text-jt hover:underline font-mono">{t.ticket_no as string}</Link>
                    {t.is_overdue && <span className="ml-1 text-xs text-red-500">[即将超时]</span>}
                  </td>
                  <td className="py-2 pr-3">{t.waybill_code as string}</td>
                  <td className="py-2 pr-3">{TYPE_LABELS[t.exception_type as string] || t.exception_type}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${t.source === 'SCAN' ? 'bg-jt-light text-jt' : 'bg-blue-50 text-blue-600'}`}>
                      {t.source === 'SCAN' ? '扫描' : '手工'}
                    </span>
                  </td>
                  <td className={`py-2 pr-3 font-medium ${STATE_COLORS[t.state as string] || ''}`}>{STATE_LABELS[t.state as string]}</td>
                  <td className="py-2 pr-3">¥{(t.amount as number)?.toFixed?.(0) ?? t.amount}</td>
                  <td className="py-2 pr-3">{(t.reporter_name as string) || '—'}</td>
                  <td className="py-2 pr-3 text-jt-text-secondary text-xs">{new Date(t.created_at as string).toLocaleString()}</td>
                </tr>
              ))}
              {list.length === 0 && !loading && (
                <tr><td colSpan={8} className="py-8 text-center text-jt-text-secondary">暂无工单</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end">
          <Pagination page={page} total={total} limit={limit} onChange={(p) => load(p)} />
        </div>
      </Card>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(1); }} toast={toast} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated, toast }: { onClose: () => void; onCreated: () => void; toast: (t: 'success' | 'error' | 'warning' | 'info', m: string) => void }) {
  const [form, setForm] = useState({ waybill_code: '', exception_type: 'LOST', amount: '', description: '' });
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.waybill_code) { toast('error', '请输入运单号'); return; }
    setSubmitting(true);
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waybill_code: form.waybill_code,
        exception_type: form.exception_type,
        amount: form.amount ? Number(form.amount) : undefined,
        description: form.description,
      }),
    });
    const j = await res.json();
    setSubmitting(false);
    if (j.success) {
      toast('success', j.message);
      onCreated();
    } else {
      toast('error', j.message);
    }
  };

  const checkWaybill = async () => {
    if (!form.waybill_code) return;
    setChecking(true);
    const res = await fetch(`/api/sync/waybills?q=${form.waybill_code}`);
    setChecking(false);
    void res;
  };

  const logisticsOptions = [
    { value: 'LOST', label: '丢件' }, { value: 'DAMAGED', label: '破损' },
    { value: 'REFUSED', label: '客户拒收' }, { value: 'TIMEOUT_UNSIGNED', label: '超时未签收' },
    { value: 'WRONG_ADDRESS', label: '地址错误' },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-4">上报物流异常</h2>
        <div className="space-y-3">
          <div>
            <Input label="运单号" value={form.waybill_code} onChange={(e) => setForm({ ...form, waybill_code: (e.target as HTMLInputElement).value })} placeholder="如 WB20260001，需 V2 真实存在" onBlur={checkWaybill} />
            {checking && <div className="text-xs text-jt-text-secondary mt-1">校验中...</div>}
          </div>
          <div>
            <label className="block text-xs text-jt-text-secondary mb-1">异常类型</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={form.exception_type} onChange={(e) => setForm({ ...form, exception_type: e.target.value })}>
              {logisticsOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Input label="金额（元，留空取 V2 估算）" value={form.amount} onChange={(e) => setForm({ ...form, amount: (e.target as HTMLInputElement).value })} type="number" />
          <div>
            <label className="block text-xs text-jt-text-secondary mb-1">情况描述</label>
            <textarea className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button
              className="text-xs text-jt mt-1 hover:underline"
              onClick={async () => {
                if (!form.description.trim()) { toast('warning', '请先填写描述'); return; }
                const res = await fetch('/api/ai/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: form.description }) });
                const j = await res.json();
                if (j.success && j.data.available && j.data.suggestion) {
                  const sug = j.data.suggestion as { exception_type?: string; severity?: string; reason?: string };
                  if (sug.exception_type) setForm((f) => ({ ...f, exception_type: sug.exception_type! }));
                  toast('info', `AI 建议：${sug.exception_type || ''} / ${sug.severity || ''}（需人工确认）`);
                } else {
                  toast('info', j.data?.message || 'AI 不可用');
                }
              }}
            >
              ✨ AI 推荐异常类型（需人工确认）
            </button>
          </div>
          <div className="text-xs text-jt-text-secondary bg-jt-light p-2 rounded">
            提交时会实时调用 V2 接口校验运单真实性。
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-jt-text-secondary">取消</button>
          <Button onClick={submit} disabled={submitting}>{submitting ? '提交中...' : '提交上报'}</Button>
        </div>
      </div>
    </div>
  );
}
