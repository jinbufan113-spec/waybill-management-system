'use client';

import { useEffect, useRef } from 'react';
import Button from './Button';

interface ModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onConfirm?: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  width?: string;
  hideFooter?: boolean;
}

export default function Modal({
  open,
  title,
  children,
  onConfirm,
  onCancel,
  confirmText = '确定',
  cancelText = '取消',
  loading = false,
  width = 'max-w-6xl',
  hideFooter = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      el.showModal();
    } else {
      el.close();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`${width} backdrop:bg-black/30`}
      style={{
        borderRadius: '12px',
        border: 'none',
        padding: '10px',
        maxWidth: '96vw',
        maxHeight: '96vh',
        margin: 'auto',
      }}
      onClose={onCancel}
    >
      <div className="bg-white overflow-hidden flex flex-col" style={{ borderRadius: '8px', maxHeight: 'calc(96vh - 20px)' }}>
        <div className="flex items-center justify-between border-b border-jt-border/50 shrink-0" style={{ padding: '20px 24px 16px' }}>
          <h3 className="text-lg font-semibold text-jt-text">{title}</h3>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-auto flex-1" style={{ padding: '20px 24px' }}>{children}</div>
        {!hideFooter && (
          <div className="flex justify-end gap-3 border-t border-jt-border/50 shrink-0" style={{ padding: '16px 24px' }}>
            <Button variant="ghost" onClick={onCancel} disabled={loading}>
              {cancelText}
            </Button>
            {onConfirm && (
              <Button onClick={onConfirm} loading={loading}>
                {confirmText}
              </Button>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
