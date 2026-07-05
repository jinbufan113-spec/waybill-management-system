'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useUser } from '@/lib/auth-client';
import { useToast } from '@/components/ui/Toast';

export default function TicketActions({ ticket }: { ticket: Record<string, unknown> }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [modal, setModal] = useState<null | { kind: 'submit' | 'approve' | 'reject' | 'qc_action' | 'quick_release'; level?: 1 | 2 }>(null);
  const [opinion, setOpinion] = useState('');
  const [qcAction, setQcAction] = useState<'RELEASE' | 'RETURN_SUPPLIER' | 'REPURCHASE' | 'DOWNGRADE'>('RETURN_SUPPLIER');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const state = ticket.state as string;
  const source = ticket.source as string;
  const reporterId = ticket.reporter_id as number;
  const isOwn = reporterId === user.id;
  const canL1 = user.roles.includes('approver_l1') || user.roles.includes('approver_l2') || user.roles.includes('qc_supervisor');
  const canL2 = user.roles.includes('approver_l2') || user.roles.includes('qc_supervisor');
  const isQcSupervisor = user.roles.includes('qc_supervisor');

  const call = async (url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    setBusy(true);
    const idem = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idem, ...headers },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    setBusy(false);
    setModal(null);
    setOpinion('');
    if (j.success) { toast('success', j.message); setTimeout(() => window.location.reload(), 600); }
    else { toast('error', j.message); }
  };

  const buttons: React.ReactNode[] = [];

  // 提交进入审批（上报人且待审批）
  if (state === 'PENDING' && !isOwn && (canL1 || canL2)) {
    // 别人也能帮忙提交（演示便利）
  }
  if (state === 'PENDING') {
    buttons.push(<Button key="submit" onClick={() => setModal({ kind: 'submit' })} disabled={busy}>提交审批</Button>);
  }

  // 一级审批
  if (state === 'L1_REVIEWING' && canL1 && !isOwn) {
    buttons.push(<Button key="approve1" onClick={() => setModal({ kind: 'approve', level: 1 })} disabled={busy}>一级通过</Button>);
    buttons.push(<Button key="reject1" variant="danger" onClick={() => setModal({ kind: 'reject', level: 1 })} disabled={busy}>拒绝</Button>);
  }

  // 二级审批
  if (state === 'L2_REVIEWING' && canL2 && !isOwn) {
    buttons.push(<Button key="approve2" onClick={() => setModal({ kind: 'approve', level: 2 })} disabled={busy}>二级通过</Button>);
    buttons.push(<Button key="reject2" variant="danger" onClick={() => setModal({ kind: 'reject', level: 2 })} disabled={busy}>拒绝</Button>);
  }

  // 品控主管误判快速放行
  if (isQcSupervisor && source === 'SCAN' && state !== 'COMPLETED' && state !== 'CLOSED_REJECTED') {
    buttons.push(<Button key="qr" variant="secondary" onClick={() => setModal({ kind: 'quick_release' })} disabled={busy}>误判快速放行</Button>);
  }

  // 品控工单执行动作
  if (state === 'EXECUTING' && source === 'SCAN' && (canL2 || isQcSupervisor)) {
    buttons.push(<Button key="exec" onClick={() => setModal({ kind: 'qc_action' })} disabled={busy}>执行品控动作</Button>);
  }

  if (buttons.length === 0) return null;

  return (
    <div className="flex gap-2">
      {buttons}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setModal(null)}>
          <div className="bg-white rounded-lg p-6 w-[420px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-3">
              {modal.kind === 'submit' && '提交审批'}
              {modal.kind === 'approve' && `L${modal.level} 审批通过`}
              {modal.kind === 'reject' && `L${modal.level} 拒绝`}
              {modal.kind === 'quick_release' && '误判快速放行'}
              {modal.kind === 'qc_action' && '执行品控动作'}
            </h3>

            <div className="space-y-3">
              {modal.kind === 'qc_action' && (
                <div>
                  <label className="block text-xs text-jt-text-secondary mb-1">执行动作</label>
                  <select className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" value={qcAction} onChange={(e) => setQcAction(e.target.value as typeof qcAction)}>
                    <option value="RELEASE">放行货物（解锁，无赔付）</option>
                    <option value="RETURN_SUPPLIER">退回供应商 + 追偿</option>
                    <option value="REPURCHASE">重新采购 + 追偿</option>
                    <option value="DOWNGRADE">降级处理 + 追偿差价</option>
                  </select>
                </div>
              )}

              {(modal.kind === 'approve' || modal.kind === 'reject' || modal.kind === 'quick_release') && (
                <div>
                  <label className="block text-xs text-jt-text-secondary mb-1">
                    {modal.kind === 'quick_release' ? '复核原因（必填，留痕）' : '审批意见'}
                  </label>
                  <textarea className="w-full border border-jt-border rounded px-2 py-1.5 text-sm" rows={3} value={opinion} onChange={(e) => setOpinion(e.target.value)} />
                </div>
              )}

              {modal.kind === 'submit' && (
                <p className="text-sm text-jt-text-secondary">将工单提交至一级审批人处理。</p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-jt-text-secondary">取消</button>
              <Button
                disabled={busy || (modal.kind === 'quick_release' && !opinion.trim())}
                onClick={() => {
                  if (modal.kind === 'submit') call(`/api/tickets/${ticket.id}/submit`, {});
                  else if (modal.kind === 'approve') call('/api/approvals', { ticket_id: ticket.id, decision: 'APPROVE', level: modal.level, opinion });
                  else if (modal.kind === 'reject') call('/api/approvals', { ticket_id: ticket.id, decision: 'REJECT', level: modal.level, opinion });
                  else if (modal.kind === 'quick_release') call('/api/qc/quick-release', { ticket_id: ticket.id, reason: opinion });
                  else if (modal.kind === 'qc_action') call('/api/execution', { ticket_id: ticket.id, action: qcAction });
                }}
              >
                {busy ? '处理中...' : '确认'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
