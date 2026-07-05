'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useUser } from '@/lib/auth-client';
import { useToast } from '@/components/ui/Toast';

export default function ConfigPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<Record<string, { value: unknown; description?: string }>>({});
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/config');
    const j = await res.json();
    if (j.success) {
      const cfgMap: Record<string, { value: unknown; description?: string }> = {};
      for (const c of j.data.configs as { key: string; value: unknown; description: string }[]) {
        cfgMap[c.key] = { value: c.value, description: c.description };
      }
      setConfigs(cfgMap);
      setRules(j.data.qc_rules);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (key: string, rawValue: string) => {
    let parsed: unknown = rawValue;
    try { parsed = JSON.parse(rawValue); } catch { /* 字符串保留 */ }
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: parsed }),
    });
    const j = await res.json();
    if (j.success) toast('success', `${key} 已更新`);
    else toast('error', j.message);
  };

  if (loading) return <div className="p-6 text-jt-text-secondary">加载中...</div>;

  const isSupervisor = user?.roles.includes('qc_supervisor');

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-jt-text">后台配置</h1>
        <p className="text-sm text-jt-text-secondary mt-1">
          可配置的分级规则与品控阈值（呼应 V2 规则引擎理念，不硬编码）
          {!isSupervisor && <span className="ml-2 text-amber-600">（仅品控主管可修改，当前为只读）</span>}
        </p>
      </div>

      <Card title="系统配置（分级审批 / 超时 / 同步）">
        <div className="space-y-3">
          {Object.entries(configs).map(([key, cfg]) => (
            <ConfigRow key={key} k={key} cfg={cfg} editable={!!isSupervisor} onSave={save} />
          ))}
        </div>
      </Card>

      <Card title="品控规则（触发条件可配置）">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-jt-text-secondary border-b border-jt-border text-xs">
            <th className="py-2 pr-3">子类型</th><th className="py-2 pr-3">名称</th><th className="py-2 pr-3">条件</th><th className="py-2 pr-3">严重度</th><th className="py-2 pr-3">自动审批层级</th><th className="py-2 pr-3">启用</th>
          </tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id as string} className="border-b border-jt-border">
                <td className="py-2 pr-3">{r.sub_type as string}</td>
                <td className="py-2 pr-3">{r.name as string}</td>
                <td className="py-2 pr-3 text-xs font-mono">{JSON.stringify(r.conditions)}</td>
                <td className="py-2 pr-3">{r.severity as string}</td>
                <td className="py-2 pr-3">L{r.auto_level as number}</td>
                <td className="py-2 pr-3">{r.enabled ? <span className="text-green-600">是</span> : <span className="text-red-500">否</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ConfigRow({ k, cfg, editable, onSave }: { k: string; cfg: { value: unknown; description?: string }; editable: boolean; onSave: (k: string, v: string) => void }) {
  const [val, setVal] = useState(typeof cfg.value === 'object' ? JSON.stringify(cfg.value) : String(cfg.value));
  return (
    <div className="flex items-center gap-3">
      <div className="w-[240px]">
        <div className="text-sm font-medium font-mono">{k}</div>
        <div className="text-xs text-jt-text-secondary">{cfg.description || ''}</div>
      </div>
      <input
        className="flex-1 border border-jt-border rounded px-2 py-1 text-sm"
        value={val}
        disabled={!editable}
        onChange={(e) => setVal(e.target.value)}
      />
      {editable && <Button size="sm" onClick={() => onSave(k, val)}>保存</Button>}
    </div>
  );
}
