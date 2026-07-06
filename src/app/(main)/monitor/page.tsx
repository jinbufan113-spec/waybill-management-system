'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface MonitorData {
  total_calls: number;
  success_calls: number;
  calls_24h: number;
  success_24h: number;
  success_rate_24h: number;
  last_sync: string | null;
  last_request_id: string | null;
  recent_logs: {
    id: string;
    request_id: string;
    endpoint: string;
    method: string;
    status_code: number | null;
    duration_ms: number | null;
    success: boolean;
    error_class: string | null;
    created_at: string;
  }[];
  error_breakdown: { error_class: string; cnt: number }[];
}

export default function MonitorPage() {
  const { toast } = useToast();
  const [data, setData] = useState<MonitorData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/sync/monitor');
    const j = await res.json();
    if (j.success) setData(j.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const sync = async () => {
    setSyncing(true);
    const res = await fetch('/api/sync/waybills', { method: 'POST' });
    const j = await res.json();
    if (j.success) {
      toast('success', `同步完成：${j.data.synced} 条`);
    } else {
      toast('error', j.message || '同步失败');
    }
    setSyncing(false);
    load();
  };

  if (loading) return <div className="p-6 text-jt-text-secondary">加载中...</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-jt-text">接口同步监控</h1>
          <p className="text-sm text-jt-text-secondary mt-1">V3 ↔ V2 跨系统接口调用情况 · Request-ID 全链路追踪</p>
        </div>
        <Button onClick={sync} disabled={syncing}>{syncing ? '同步中...' : '立即同步运单'}</Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card title="最近一次同步">
          <div className="text-sm font-medium">{data?.last_sync ? new Date(data.last_sync).toLocaleString() : '—'}</div>
          <div className="text-xs text-jt-text-secondary mt-1 break-all">{data?.last_request_id || ''}</div>
        </Card>
        <Card title="24h 调用次数">
          <div className="text-2xl font-bold text-jt">{data?.calls_24h ?? 0}</div>
          <div className="text-xs text-jt-text-secondary mt-1">成功 {data?.success_24h ?? 0} 次</div>
        </Card>
        <Card title="24h 成功率">
          <div className={`text-2xl font-bold ${(data?.success_rate_24h ?? 0) >= 95 ? 'text-green-600' : 'text-amber-600'}`}>
            {data?.success_rate_24h ?? 0}%
          </div>
        </Card>
        <Card title="累计调用">
          <div className="text-2xl font-bold text-jt-text">{data?.total_calls ?? 0}</div>
          <div className="text-xs text-jt-text-secondary mt-1">总成功 {data?.success_calls ?? 0}</div>
        </Card>
      </div>

      {data && data.error_breakdown.length > 0 && (
        <Card title="错误分类（排查数据为什么对不上）">
          <div className="flex flex-wrap gap-2">
            {data.error_breakdown.map((e) => (
              <span key={e.error_class} className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs">
                {e.error_class}: {e.cnt}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card title="最近接口调用日志（取自接口同步日志表）">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-jt-text-secondary border-b border-jt-border">
                <th className="py-2 pr-3">时间</th>
                <th className="py-2 pr-3">Request-ID</th>
                <th className="py-2 pr-3">接口</th>
                <th className="py-2 pr-3">状态码</th>
                <th className="py-2 pr-3">耗时</th>
                <th className="py-2 pr-3">结果</th>
                <th className="py-2 pr-3">错误分类</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_logs || []).map((log) => (
                <tr key={log.id} className="border-b border-jt-border">
                  <td className="py-2 pr-3 text-jt-text-secondary whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-3 font-mono text-jt-text-secondary max-w-[180px] truncate" title={log.request_id}>{log.request_id}</td>
                  <td className="py-2 pr-3">{log.endpoint}</td>
                  <td className="py-2 pr-3">{log.status_code ?? '—'}</td>
                  <td className="py-2 pr-3">{log.duration_ms != null ? `${log.duration_ms}ms` : '—'}</td>
                  <td className="py-2 pr-3">
                    {log.success ? <span className="text-green-600">成功</span> : <span className="text-red-500">失败</span>}
                  </td>
                  <td className="py-2 pr-3 text-jt-text-secondary">{log.error_class || '—'}</td>
                </tr>
              ))}
              {(data?.recent_logs || []).length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-jt-text-secondary">暂无调用记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="text-xs text-jt-text-secondary bg-jt-light rounded p-3">
        提示：工单详情页展示运单信息时会标注数据来源（"实时获取自 V2" 或 "使用本地缓存，同步于 XX 时间"）。
        V2 不可用时系统降级到本地缓存，不会白屏。
      </div>
    </div>
  );
}
