'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { copy } from '@/lib/copy';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
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

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={[
        'fixed inset-0 z-50 m-auto w-full rounded-card shadow-xl p-0 bg-white',
        'backdrop:bg-black/50',
        sizeStyles[size],
      ].join(' ')}
      onClick={(e) => e.target === dialogRef.current && onClose()}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-color-border">
        <h2 className="text-base font-semibold text-secondary">{title}</h2>
        <button
          onClick={onClose}
          className="text-neutral hover:text-secondary transition-colors rounded p-1"
          aria-label={copy.general.close}
        >
          <X size={18} />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer && (
        <div className="px-6 py-4 border-t border-color-border flex justify-end gap-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
