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
import { approvePasaje, rejectPasaje } from './pasaje-actions';
import { TOPE_DIAS_TRAMITE_ANUAL, type SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';
import { formatFechaAusencia, formatRangoAusencia, motivoAusenciaLabel } from '@/lib/rotation/ausencia-display';
import { formatDiasViaje, motivoViajeLabel } from '@/lib/rotation/pasaje-display';
import type { OverwriteDay, OverwriteStatus } from './page';
import type { AusenciaRequest, Document, PasajeRequest, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type DocumentWithUser = Document & { user_profile?: UserProfilePick | null };
type AusenciaWithUser = AusenciaRequest & { user_profile?: UserProfilePick | null };
type PasajeWithUser = PasajeRequest & {
  solicitante_profile?: UserProfilePick | null;
  empleado_profile?: UserProfilePick | null;
};

export type PendingItem =
  | { kind: 'documento'; data: DocumentWithUser }
  | { kind: 'ausencia'; data: AusenciaWithUser }
  | { kind: 'pasaje'; data: PasajeWithUser };

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
  // FB-F4-06 (ausencia) / FB-F4-10 (pasaje): estado de la previsualización de
  // sobrescritura por request id — aplica a items kind='ausencia' y
  // kind='pasaje'. 'ok' distingue días=[] (nada que sobrescribir) de 'error'
  // (no se pudo calcular); ambos casos son no bloqueantes: aprobar/rechazar
  // sigue disponible siempre.
  overwriteStatusByRequest?: Record<string, OverwriteStatus>;
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

// El pasaje no tiene user_profile (dos partes: solicitante y empleado) — la
// columna "usuario" muestra a quien ACTÚA (el solicitante), igual que
// documento/ausencia muestran al dueño del registro.
function userName(item: PendingItem): string {
  const p = item.kind === 'pasaje' ? item.data.solicitante_profile : item.data.user_profile;
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

function SobrescrituraAviso({ dias, aviso }: { dias: OverwriteDay[]; aviso: string }) {
  return (
    <div className="text-xs text-amber-700 mt-1">
      <p>{aviso}</p>
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
  overwriteStatusByRequest,
}: {
  item: PendingItem;
  saldoByUser: Record<string, SaldoBadgeInfo>;
  saldoLoadFailed: boolean;
  overwriteStatusByRequest: Record<string, OverwriteStatus>;
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

  if (item.kind === 'pasaje') {
    const req = item.data;
    const overwriteStatus = overwriteStatusByRequest[req.id];
    // "Para" solo se muestra cuando el empleado que viaja difiere de quien
    // solicitó (un supervisor pidiendo para sí mismo no necesita ver su
    // propio nombre repetido acá).
    const paraNombre =
      req.solicitante_id !== req.empleado_id
        ? req.empleado_profile?.full_name || req.empleado_profile?.email
        : null;

    return (
      <>
        <div>{motivoViajeLabel(req.motivo_viaje)}</div>
        <div className="text-xs mt-0.5">{req.origen} → {req.destino}</div>
        <div className="text-xs mt-0.5">{formatDiasViaje(req.dias_viaje ?? [])}</div>
        {paraNombre && (
          <div className="text-xs mt-0.5">
            {copy.aprobaciones.detallePasaje.paraLabel}: {paraNombre}
          </div>
        )}
        {req.notas && <div className="text-xs mt-0.5">{req.notas}</div>}
        {overwriteStatus?.status === 'error' && (
          <div className="text-xs text-error mt-1">{copy.aprobaciones.sobrescritura.error}</div>
        )}
        {overwriteStatus?.status === 'ok' && overwriteStatus.days.length > 0 && (
          <SobrescrituraAviso dias={overwriteStatus.days} aviso={copy.aprobaciones.sobrescritura.avisoPasaje} />
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
  const overwriteStatus = overwriteStatusByRequest[req.id];

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
      {overwriteStatus?.status === 'error' && (
        <div className="text-xs text-error mt-1">{copy.aprobaciones.sobrescritura.error}</div>
      )}
      {overwriteStatus?.status === 'ok' && overwriteStatus.days.length > 0 && (
        <SobrescrituraAviso dias={overwriteStatus.days} aviso={copy.aprobaciones.sobrescritura.aviso} />
      )}
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
  overwriteStatusByRequest = {},
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
          // FB-F4-18: approveDocument devuelve { ok, error } en vez de
          // tirar — mismo motivo que pasaje/ausencia (FB-F4-16).
          const result = await approveDocument(item.data.id);
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
        } else if (item.kind === 'pasaje') {
          // FB-F4-16: approvePasaje/approveAusencia devuelven { ok, ... } en
          // vez de tirar — Next.js redacta el mensaje de un throw que cruce
          // el límite de una Server Action en build de producción.
          const result = await approvePasaje(item.data.id);
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
          if (!result.emailSent) setActionNotice(copy.aprobaciones.messages.resolvedEmailFailed);
        } else {
          const result = await approveAusencia(item.data.id);
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
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
          const result = await rejectDocument(item.data.id, motivo);
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
        } else if (item.kind === 'pasaje') {
          const result = await rejectPasaje(item.data.id, motivo);
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
          if (!result.emailSent) setActionNotice(copy.aprobaciones.messages.resolvedEmailFailed);
        } else {
          const result = await rejectAusencia(item.data.id, motivo);
          if (!result.ok) {
            setActionError(result.error);
            return;
          }
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
                  {copy.aprobaciones.tipos[item.kind === 'documento' ? 'documento' : item.kind === 'pasaje' ? 'pasaje' : 'ausencia']}
                </td>
                <td className="py-3 px-3 text-neutral whitespace-nowrap">
                  {userName(item)}
                </td>
                <td className="py-3 px-3 text-neutral">
                  <DetalleCell
                    item={item}
                    saldoByUser={saldoByUser}
                    saldoLoadFailed={saldoLoadFailed}
                    overwriteStatusByRequest={overwriteStatusByRequest}
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
