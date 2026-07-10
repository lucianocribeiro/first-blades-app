'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { approveDocument, rejectDocument } from './actions';
import { approveAusencia, rejectAusencia } from './ausencia-actions';
import type { AusenciaRequest, Document, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type DocumentWithUser = Document & { user_profile?: UserProfilePick | null };
type AusenciaWithUser = AusenciaRequest & { user_profile?: UserProfilePick | null };

export type PendingItem =
  | { kind: 'documento'; data: DocumentWithUser }
  | { kind: 'ausencia'; data: AusenciaWithUser };

type AprobacionesTableProps = {
  items: PendingItem[];
};

function documentTypeLabel(type: string): string {
  const labels = copy.documentos.tipos as Record<string, string>;
  return labels[type] ?? type;
}

function certTipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return '';
  const labels = copy.documentos.certificadoTipos as Record<string, string>;
  return labels[tipo] ?? tipo;
}

function formatFecha(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR');
}

function userName(item: PendingItem): string {
  const p = item.data.user_profile;
  if (!p) return '—';
  return p.full_name || p.email || '—';
}

function DetalleCell({ item }: { item: PendingItem }) {
  if (item.kind === 'documento') {
    const doc = item.data;
    return (
      <>
        <div>{documentTypeLabel(doc.document_type)}</div>
        {doc.document_type === 'certificado' && doc.certificado_tipo && (
          <div className="text-xs mt-0.5">
            {certTipoLabel(doc.certificado_tipo)}
            {doc.certificado_otros_texto && ` — ${doc.certificado_otros_texto}`}
          </div>
        )}
      </>
    );
  }

  const req = item.data;
  return (
    <>
      <div>{formatFecha(req.fecha_inicio)}</div>
      {req.notas && <div className="text-xs mt-0.5">{req.notas}</div>}
    </>
  );
}

function RejectModal({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
  isPending: boolean;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  function handleConfirm() {
    if (!motivo.trim()) {
      setError(copy.aprobaciones.rejectModal.motivoRequired);
      return;
    }
    onConfirm(motivo);
  }

  function handleClose() {
    setMotivo('');
    setError('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={copy.aprobaciones.rejectModal.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isPending}>
            {copy.aprobaciones.rejectModal.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          label={copy.aprobaciones.rejectModal.motivoLabel}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={copy.aprobaciones.rejectModal.motivoPlaceholder}
          rows={4}
          error={error}
          required
        />
      </div>
    </Modal>
  );
}

export function AprobacionesTable({ items }: AprobacionesTableProps) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [rejectTarget, setRejectTarget] = useState<PendingItem | null>(null);

  function handleApprove(item: PendingItem) {
    setActionError('');
    setActionNotice('');
    startTransition(async () => {
      try {
        if (item.kind === 'documento') {
          await approveDocument(item.data.id);
        } else {
          const result = await approveAusencia(item.data.id);
          if (!result.emailSent) setActionNotice(copy.aprobaciones.messages.resolvedEmailFailed);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobaciones.messages.approveError);
      }
    });
  }

  function handleRejectConfirm(motivo: string) {
    if (!rejectTarget) return;
    const item = rejectTarget;
    setRejectTarget(null);
    setActionError('');
    setActionNotice('');
    startTransition(async () => {
      try {
        if (item.kind === 'documento') {
          await rejectDocument(item.data.id, motivo);
        } else {
          const result = await rejectAusencia(item.data.id, motivo);
          if (!result.emailSent) setActionNotice(copy.aprobaciones.messages.resolvedEmailFailed);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobaciones.messages.rejectError);
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral py-8 text-center">{copy.aprobaciones.noItems}</p>
    );
  }

  return (
    <>
      {actionError && (
        <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {actionError}
        </p>
      )}
      {actionNotice && (
        <div className="mb-4">
          <InfoBanner message={actionNotice} />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-color-border">
              {[
                copy.aprobaciones.table.tipo,
                copy.aprobaciones.table.usuario,
                copy.aprobaciones.table.detalle,
                copy.aprobaciones.table.fecha,
                copy.aprobaciones.table.estado,
                copy.aprobaciones.table.acciones,
              ].map((h) => (
                <th key={h} className="text-left py-2 px-3 text-xs font-medium text-neutral uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-color-border">
            {items.map((item) => (
              <tr key={`${item.kind}-${item.data.id}`} className="hover:bg-surface/50 transition-colors">
                <td className="py-3 px-3 font-medium text-secondary whitespace-nowrap">
                  {item.kind === 'documento' ? copy.aprobaciones.tipos.documento : copy.aprobaciones.tipos.ausencia}
                </td>
                <td className="py-3 px-3 text-neutral whitespace-nowrap">
                  {userName(item)}
                </td>
                <td className="py-3 px-3 text-neutral">
                  <DetalleCell item={item} />
                </td>
                <td className="py-3 px-3 text-neutral text-xs whitespace-nowrap">
                  {new Date(item.data.created_at).toLocaleDateString('es-AR')}
                </td>
                <td className="py-3 px-3">
                  <StatusBadge status={item.data.estado} />
                </td>
                <td className="py-3 px-3">
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => handleApprove(item)}
                      disabled={isPending}
                    >
                      {copy.aprobaciones.actions.aprobar}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setRejectTarget(item)}
                      disabled={isPending}
                    >
                      {copy.aprobaciones.actions.rechazar}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RejectModal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleRejectConfirm}
        isPending={isPending}
      />
    </>
  );
}
