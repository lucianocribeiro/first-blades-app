import type { Enums } from '@/supabase/types';
import { copy } from '@/lib/copy';

export type PurgatoryStatus = Enums<'approval_status'>;

export function isPending(status: PurgatoryStatus): boolean {
  return status === 'pendiente';
}

export function isApproved(status: PurgatoryStatus): boolean {
  return status === 'aprobado';
}

export function isRejected(status: PurgatoryStatus): boolean {
  return status === 'rechazado';
}

export function statusLabel(status: PurgatoryStatus): string {
  const labels: Record<PurgatoryStatus, string> = {
    pendiente: copy.status.pendiente,
    aprobado:  copy.status.aprobado,
    rechazado: copy.status.rechazado,
  };
  return labels[status];
}
