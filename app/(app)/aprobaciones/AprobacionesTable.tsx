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
import { TOPE_DIAS_TRAMITE_ANUAL, type SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';
import { formatFechaAusencia, formatRangoAusencia, motivoAusenciaLabel } from '@/lib/rotation/ausencia-display';
import type { OverwriteDay } from './page';
import type { AusenciaRequest, Document, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type DocumentWithUser = Document & { user_profile?: UserProfilePick | null };
type AusenciaWithUser = AusenciaRequest & { user_profile?: UserProfilePick | null };

export type PendingItem =
  | { kind: 'documento'; data: DocumentWithUser }
  | { kind: 'ausencia'; data: AusenciaWithUser };

type SaldoBadgeInfo = Pick<SaldoDiasTramite, 'consumidos' | 'excedido'>;

type AprobacionesTableProps = {
  items: PendingItem[];
  // FB-F3-21: saldo del solicitante, keyeado por user_id — solo aplica a
  // items kind='ausencia' con motivo_ausencia='dia_tramite'. No bloquea la
  // aprobación, es informativo.
  saldoByUser?: Record<string, SaldoBadgeInfo>;
  // FB-F3-22: si la query de saldo falló server-side, `saldoByUser` queda
  // vacío — eso NO puede leerse como "sin días consumidos" (dato válido).
  // Con esta señal, la celda muestra un estado de error visible en vez de
  // simplemente omitir el badge.
  saldoLoadFailed?: boolean;
  // FB-F4-05: días del rango de la solicitud que ya tienen fila en
  // rotation_assignments, keyeado por request id — solo aplica a
  // items kind='ausencia'. Aviso no bloqueante: informa, no impide aprobar.
  overwritesByRequest?: Record<string, OverwriteDay[]>;
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

function userName(item: PendingItem): string {
  const p = item.data.user_profile;
  if (!p) return '—';
  return p.full_name || p.email || '—';
}

function SaldoBadge({ saldo }: { saldo: SaldoBadgeInfo }) {
  const t = copy.aprobaciones.badgeSaldo;
  const label = saldo.excedido
    ? `${saldo.consumidos}/${TOPE_DIAS_TRAMITE_ANUAL} — ${t.excede}`
    : `${t.usado} ${saldo.consumidos} ${t.de} ${TOPE_DIAS_TRAMITE_ANUAL}`;

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
        saldo.excedido
          ? 'bg-error/10 text-error border border-error/30'
          : 'bg-surface text-neutral border border-color-border'
      }`}
    >
      {label}
    </span>
  );
}

function SobrescrituraAviso({ dias }: { dias: OverwriteDay[] }) {
  return (
    <div className="text-xs text-amber-700 mt-1">
      <p>{copy.aprobaciones.sobrescritura.aviso}</p>
      <ul className="list-disc pl-4">
        {dias.map((d) => (
          <li key={d.fecha}>
            {formatFechaAusencia(d.fecha)}: {copy.status[d.estado_dia]}
            {d.es_estimado && ` (${copy.calendario.leyenda.estimado})`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetalleCell({
  item,
  saldoByUser,
  saldoLoadFailed,
  overwritesByRequest,
}: {
  item: PendingItem;
  saldoByUser: Record<string, SaldoBadgeInfo>;
  saldoLoadFailed: boolean;
  overwritesByRequest: Record<string, OverwriteDay[]>;
}) {
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
  // El badge de saldo solo tiene sentido para día de trámite: es el único
  // motivo con tope anual (FB-F3-21). Un solicitante puede tener consumo de
  // día de trámite este año aunque el ítem pendiente sea de otro motivo —
  // el badge no debe mostrarse en ese caso.
  const showSaldo = req.motivo_ausencia === 'dia_tramite';
  const saldo = showSaldo ? saldoByUser[req.user_id] : undefined;
  const overwriteDias = overwritesByRequest[req.id];

  return (
    <>
      <div>{motivoAusenciaLabel(req.motivo_ausencia, req.motivo_otros_texto)}</div>
      <div className="text-xs mt-0.5">{formatRangoAusencia(req.fecha_inicio, req.fecha_fin)}</div>
      {req.notas && <div className="text-xs mt-0.5">{req.notas}</div>}
      {showSaldo &&
        (saldoLoadFailed ? (
          <div className="text-xs text-error mt-1">{copy.aprobaciones.badgeSaldo.error}</div>
        ) : (
          saldo && (
            <div>
              <SaldoBadge saldo={saldo} />
            </div>
          )
        ))}
      {overwriteDias && overwriteDias.length > 0 && <SobrescrituraAviso dias={overwriteDias} />}
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

export function AprobacionesTable({
  items,
  saldoByUser = {},
  saldoLoadFailed = false,
  overwritesByRequest = {},
}: AprobacionesTableProps) {
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
                  <DetalleCell
                    item={item}
                    saldoByUser={saldoByUser}
                    saldoLoadFailed={saldoLoadFailed}
                    overwritesByRequest={overwritesByRequest}
                  />
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
