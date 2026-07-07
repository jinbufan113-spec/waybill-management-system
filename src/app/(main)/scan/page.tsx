'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

export default function ScanPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    waybill_code: '', sku_code: '', actual_quantity: '',
    damage_level: 'NONE', label_match: 'true', batch_anomaly: 'false',
  });
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.waybill_code || !form.sku_code) { toast('error', '运单号与 SKU 必填'); return; }
    setBusy(true);
    setResult(null);
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waybill_code: form.waybill_code,
        sku_code: form.sku_code,
        actual_quantity: form.actual_quantity ? Number(form.actual_quantity) : undefined,
        damage_level: form.damage_level,
        label_match: form.label_match === 'true',
        batch_anomaly: form.batch_anomaly === 'true',
      }),
    });
    const j = await res.json();
    setBusy(false);
    if (j.success) {
      setResult(j.data);
      toast('success', j.message);
    } else {
      toast('error', j.message);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-jt-text">扫描品控</h1>
        <p className="text-sm text-jt-text-secondary mt-1">手工输入条码/SKU 模拟扫描枪 · 实时校验 SKU 归属 · 品控规则引擎自动判定</p>
      </div>

      <Card title="扫描录入">
        <div className="grid grid-cols-3 gap-3">
          <Input label="运单号" value={form.waybill_code} onChange={(e) => setForm({ ...form, waybill_code: (e.target as HTMLInputElement).value })} placeholder="如 WB20260001" />
          <Input label="SKU 编码" value={form.sku_code} onChange={(e) => setForm({ ...form, sku_code: (e.target as HTMLInputElement).value })} placeholder="如 SKU-1001" />
          <Input label="实际数量" value={form.actual_quantity} onChange={(e) => setForm({ ...form, actual_quantity: (e.target as HTMLInputElement).value })} type="number" placeholder="留空跳过数量检查" />
          <div>
            <label className="block text-xs text-jt-text-secondary mb-1">破损等级</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={form.damage_level} onChange={(e) => setForm({ ...form, damage_level: e.target.value })}>
              <option value="NONE">无</option><option value="MINOR">轻微</option><option value="MEDIUM">中等</option><option value="SEVERE">严重</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-jt-text-secondary mb-1">标签匹配</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={form.label_match} onChange={(e) => setForm({ ...form, label_match: e.target.value })}>
              <option value="true">匹配</option><option value="false">不匹配</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-jt-text-secondary mb-1">批次异常</label>
            <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={form.batch_anomaly} onChange={(e) => setForm({ ...form, batch_anomaly: e.target.value })}>
              <option value="false">否</option><option value="true">是</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={submit} disabled={busy}>{busy ? '扫描中...' : '执行扫描'}</Button>
        </div>
      </Card>

      {result && (
        <Card title="品控判定结果">
          <div className="text-sm space-y-2">
            <div>结果：<span className={result.result === 'PASS' ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>{result.result === 'PASS' ? '通过' : '异常'}</span></div>
            <div>动作：{String(result.action)}</div>
            {result.ticket_no && <div>工单号：<span className="font-mono">{String(result.ticket_no)}</span></div>}
            {result.sub_type && <div>异常子类型：{String(result.sub_type)}</div>}
            {result.severity && <div>严重度：{String(result.severity)}</div>}
            {result.hit_rule_id && <div className="text-xs text-jt-text-secondary">命中规则 ID：{String(result.hit_rule_id)}</div>}
            {result.message && <div className="text-jt-text-secondary">{String(result.message)}</div>}
            {result.request_id && <div className="text-xs text-jt-text-secondary">V2 校验 Request-ID：{String(result.request_id)}</div>}
          </div>
        </Card>
      )}

      <div className="text-xs text-jt-text-secondary bg-jt-light rounded p-3 space-y-1">
        <div>说明：扫描会实时调用 V2 接口校验 SKU 归属真实存在的运单。</div>
        <div>• 判定异常 → 批次自动锁定 + 创建品控工单（进入二级审批）</div>
        <div>• 重复扫描同批次 → 幂等追加记录，不重复建工单</div>
        <div>• 品控主管可在工单详情页"误判快速放行"</div>
      </div>
    </div>
  );
}
