'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { approveDocument, rejectDocument } from './actions';
import type { Document, Profile } from '@/lib/db-types';

type DocumentWithUser = Document & {
  user_profile?: Pick<Profile, 'nombre' | 'apellido' | 'email'> | null;
};

type AprobacionesTableProps = {
  documents: DocumentWithUser[];
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

function userName(doc: DocumentWithUser): string {
  const p = doc.user_profile;
  if (!p) return '—';
  if (p.nombre && p.apellido) return `${p.nombre} ${p.apellido}`;
  return p.email ?? '—';
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

export function AprobacionesTable({ documents }: AprobacionesTableProps) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState('');
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  function handleApprove(id: string) {
    setActionError('');
    startTransition(async () => {
      try {
        await approveDocument(id);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobaciones.messages.approveError);
      }
    });
  }

  function handleRejectConfirm(motivo: string) {
    if (!rejectTargetId) return;
    const id = rejectTargetId;
    setRejectTargetId(null);
    setActionError('');
    startTransition(async () => {
      try {
        await rejectDocument(id, motivo);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobaciones.messages.rejectError);
      }
    });
  }

  if (documents.length === 0) {
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
            {documents.map((doc) => (
              <tr key={doc.id} className="hover:bg-surface/50 transition-colors">
                <td className="py-3 px-3 font-medium text-secondary whitespace-nowrap">
                  {copy.aprobaciones.tipos.documento}
                </td>
                <td className="py-3 px-3 text-neutral whitespace-nowrap">
                  {userName(doc)}
                </td>
                <td className="py-3 px-3 text-neutral">
                  <div>{documentTypeLabel(doc.document_type)}</div>
                  {doc.document_type === 'certificado' && doc.certificado_tipo && (
                    <div className="text-xs mt-0.5">
                      {certTipoLabel(doc.certificado_tipo)}
                      {doc.certificado_otros_texto && ` — ${doc.certificado_otros_texto}`}
                    </div>
                  )}
                </td>
                <td className="py-3 px-3 text-neutral text-xs whitespace-nowrap">
                  {new Date(doc.created_at).toLocaleDateString('es-AR')}
                </td>
                <td className="py-3 px-3">
                  <StatusBadge status={doc.estado} />
                </td>
                <td className="py-3 px-3">
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => handleApprove(doc.id)}
                      disabled={isPending}
                    >
                      {copy.aprobaciones.actions.aprobar}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setRejectTargetId(doc.id)}
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
        open={rejectTargetId !== null}
        onClose={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
        isPending={isPending}
      />
    </>
  );
}
