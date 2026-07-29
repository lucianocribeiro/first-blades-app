'use client';

import { useMemo, useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { X, Plus } from 'lucide-react';
import {
  cancelarAusencia,
  editarFechasAusencia,
  cancelarPasaje,
  editarFechasPasaje,
  previewOverwriteAusencia,
  previewOverwritePasaje,
} from './actions';
import { formatFechaAusencia, formatRangoAusencia, motivoAusenciaLabel } from '@/lib/rotation/ausencia-display';
import { formatDiasViaje, motivoViajeLabel } from '@/lib/rotation/pasaje-display';
import type { OverwriteDay, OverwriteStatus } from '@/lib/rotation/overwrite-status';
import type { AusenciaWithUser, PasajeWithUser } from './page';

export type AprobadaItem =
  | { kind: 'ausencia'; data: AusenciaWithUser }
  | { kind: 'pasaje'; data: PasajeWithUser };

type AusenciaItem = Extract<AprobadaItem, { kind: 'ausencia' }>;
type PasajeItem = Extract<AprobadaItem, { kind: 'pasaje' }>;

type Employee = { id: string; label: string };

function itemEmpleadoId(item: AprobadaItem): string {
  return item.kind === 'ausencia' ? item.data.user_id : item.data.empleado_id;
}

function itemEmpleadoNombre(item: AprobadaItem): string {
  const profile = item.kind === 'ausencia' ? item.data.user_profile : item.data.empleado_profile;
  return profile?.full_name || profile?.email || '—';
}

// Vigente = todavía se puede cancelar/editar. Una vez cancelada, la RPC
// rechaza cualquier otro cambio (0017) — la UI refleja eso ocultando las
// acciones, no solo dejándolas fallar al tocarlas.
function isVigente(item: AprobadaItem): boolean {
  return item.data.post_aprobacion_tipo !== 'cancelada';
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('es-AR');
}

function MarcaCell({ item }: { item: AprobadaItem }) {
  const tipo = item.data.post_aprobacion_tipo;
  if (!tipo) return <span className="text-neutral">{copy.aprobadas.marca.sinCambios}</span>;

  return (
    <div>
      <StatusBadge status={tipo} />
      {item.data.comentario_post_aprobacion && (
        <div className="text-xs mt-1">
          <span className="text-neutral">{copy.aprobadas.marca.comentarioLabel}: </span>
          {item.data.comentario_post_aprobacion}
        </div>
      )}
      {item.data.post_aprobacion_at && (
        <div className="text-xs text-neutral mt-0.5">
          {copy.aprobadas.marca.fechaLabel}: {formatTimestamp(item.data.post_aprobacion_at)}
        </div>
      )}
    </div>
  );
}

function DetalleCell({ item }: { item: AprobadaItem }) {
  if (item.kind === 'pasaje') {
    const req = item.data;
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
      </>
    );
  }

  const req = item.data;
  return (
    <>
      <div>{motivoAusenciaLabel(req.motivo_ausencia, req.motivo_otros_texto)}</div>
      <div className="text-xs mt-0.5">{formatRangoAusencia(req.fecha_inicio, req.fecha_fin)}</div>
      {req.notas && <div className="text-xs mt-0.5">{req.notas}</div>}
    </>
  );
}

function SobrescrituraPreview({ status }: { status: OverwriteStatus | null }) {
  if (!status) return null;
  if (status.status === 'error') {
    return <p className="text-xs text-error mt-2">{copy.aprobadas.sobrescritura.error}</p>;
  }
  if (status.days.length === 0) {
    return <p className="text-xs text-neutral mt-2">{copy.aprobadas.sobrescritura.vacio}</p>;
  }
  return (
    <div className="text-xs text-amber-700 mt-2">
      <p>{copy.aprobadas.sobrescritura.aviso}</p>
      <ul className="list-disc pl-4">
        {status.days.map((d: OverwriteDay) => (
          <li key={d.fecha}>
            {formatFechaAusencia(d.fecha)}: {copy.status[d.estado_dia]}
            {d.es_estimado && ` (${copy.calendario.leyenda.estimado})`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CancelModal({
  item,
  onClose,
  onConfirm,
  isPending,
}: {
  item: AprobadaItem | null;
  onClose: () => void;
  onConfirm: (comentario: string) => void;
  isPending: boolean;
}) {
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState('');

  function handleConfirm() {
    if (!comentario.trim()) {
      setError(copy.aprobadas.cancelModal.comentarioRequired);
      return;
    }
    onConfirm(comentario);
  }

  function handleClose() {
    setComentario('');
    setError('');
    onClose();
  }

  return (
    <Modal
      open={item !== null}
      onClose={handleClose}
      title={copy.aprobadas.cancelModal.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isPending}>
            {copy.aprobadas.cancelModal.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <InfoBanner message={copy.aprobadas.cancelModal.warning} />
        <Textarea
          label={copy.aprobadas.cancelModal.comentarioLabel}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder={copy.aprobadas.cancelModal.comentarioPlaceholder}
          rows={4}
          error={error}
          required
        />
      </div>
    </Modal>
  );
}

function EditAusenciaModal({
  item,
  onClose,
  onConfirm,
  isPending,
}: {
  item: AusenciaItem | null;
  onClose: () => void;
  onConfirm: (fechaInicio: string, fechaFin: string, comentario: string) => void;
  isPending: boolean;
}) {
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<OverwriteStatus | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();

  function handleClose() {
    setFechaInicio('');
    setFechaFin('');
    setComentario('');
    setError('');
    setPreview(null);
    onClose();
  }

  function handlePreview() {
    if (!item || !fechaInicio || !fechaFin) return;
    startPreviewTransition(async () => {
      const result = await previewOverwriteAusencia(item.data.id, fechaInicio, fechaFin);
      setPreview(result);
    });
  }

  function handleConfirm() {
    if (!comentario.trim()) {
      setError(copy.aprobadas.editModal.comentarioRequired);
      return;
    }
    onConfirm(fechaInicio, fechaFin, comentario);
  }

  return (
    <Modal
      open={item !== null}
      onClose={handleClose}
      title={copy.aprobadas.editModal.title}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isPending}>
            {copy.aprobadas.editModal.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            label={copy.aprobadas.editModal.fechaInicioLabel}
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            required
          />
          <DatePicker
            label={copy.aprobadas.editModal.fechaFinLabel}
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            required
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handlePreview}
          loading={isPreviewPending}
          disabled={!fechaInicio || !fechaFin}
        >
          {copy.aprobadas.editModal.previewButton}
        </Button>
        <SobrescrituraPreview status={preview} />
        <Textarea
          label={copy.aprobadas.editModal.comentarioLabel}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder={copy.aprobadas.editModal.comentarioPlaceholder}
          rows={4}
          error={error}
          required
        />
      </div>
    </Modal>
  );
}

function EditPasajeModal({
  item,
  onClose,
  onConfirm,
  isPending,
}: {
  item: PasajeItem | null;
  onClose: () => void;
  onConfirm: (diasViaje: string[], comentario: string) => void;
  isPending: boolean;
}) {
  const [dias, setDias] = useState<string[]>(['']);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<OverwriteStatus | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();

  function handleClose() {
    setDias(['']);
    setComentario('');
    setError('');
    setPreview(null);
    onClose();
  }

  function handleDiaChange(index: number, value: string) {
    setDias((prev) => prev.map((d, i) => (i === index ? value : d)));
  }

  function handleAddDia() {
    setDias((prev) => [...prev, '']);
  }

  function handleRemoveDia(index: number) {
    setDias((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePreview() {
    if (!item) return;
    const validDias = dias.filter(Boolean);
    if (validDias.length === 0) return;
    startPreviewTransition(async () => {
      const result = await previewOverwritePasaje(item.data.id, validDias);
      setPreview(result);
    });
  }

  function handleConfirm() {
    if (!comentario.trim()) {
      setError(copy.aprobadas.editModal.comentarioRequired);
      return;
    }
    onConfirm(dias.filter(Boolean), comentario);
  }

  return (
    <Modal
      open={item !== null}
      onClose={handleClose}
      title={copy.aprobadas.editModal.title}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isPending}>
            {copy.aprobadas.editModal.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-secondary">
            {copy.aprobadas.editModal.diaLabel}
            <span className="text-error ml-1">*</span>
          </label>
          {dias.map((dia, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <DatePicker
                  aria-label={`${copy.aprobadas.editModal.diaLabel} ${index + 1}`}
                  value={dia}
                  onChange={(e) => handleDiaChange(index, e.target.value)}
                />
              </div>
              {dias.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRemoveDia(index)}
                  aria-label={copy.aprobadas.editModal.quitarDia}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={handleAddDia} icon={<Plus size={16} />}>
            {copy.aprobadas.editModal.agregarDia}
          </Button>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handlePreview}
          loading={isPreviewPending}
          disabled={dias.filter(Boolean).length === 0}
        >
          {copy.aprobadas.editModal.previewButton}
        </Button>
        <SobrescrituraPreview status={preview} />
        <Textarea
          label={copy.aprobadas.editModal.comentarioLabel}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder={copy.aprobadas.editModal.comentarioPlaceholder}
          rows={4}
          error={error}
          required
        />
      </div>
    </Modal>
  );
}

type AprobadasTableProps = {
  items: AprobadaItem[];
  employees: Employee[];
};

export function AprobadasTable({ items, employees }: AprobadasTableProps) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [cancelTarget, setCancelTarget] = useState<AprobadaItem | null>(null);
  const [editAusenciaTarget, setEditAusenciaTarget] = useState<AusenciaItem | null>(null);
  const [editPasajeTarget, setEditPasajeTarget] = useState<PasajeItem | null>(null);

  const filtered = useMemo(() => {
    if (!employeeFilter) return items;
    return items.filter((item) => itemEmpleadoId(item) === employeeFilter);
  }, [items, employeeFilter]);

  function handleCancelConfirm(comentario: string) {
    if (!cancelTarget) return;
    const item = cancelTarget;
    setCancelTarget(null);
    setActionError('');
    setActionNotice('');
    startTransition(async () => {
      try {
        const result =
          item.kind === 'ausencia'
            ? await cancelarAusencia(item.data.id, comentario)
            : await cancelarPasaje(item.data.id, comentario);
        setActionNotice(
          result.emailSent ? copy.aprobadas.messages.cancelSuccess : copy.aprobadas.messages.emailFailed
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobadas.errors.generic);
      }
    });
  }

  function handleEditAusenciaConfirm(fechaInicio: string, fechaFin: string, comentario: string) {
    if (!editAusenciaTarget) return;
    const item = editAusenciaTarget;
    setEditAusenciaTarget(null);
    setActionError('');
    setActionNotice('');
    startTransition(async () => {
      try {
        const result = await editarFechasAusencia(item.data.id, comentario, fechaInicio, fechaFin);
        setActionNotice(
          result.emailSent ? copy.aprobadas.messages.editSuccess : copy.aprobadas.messages.emailFailed
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobadas.errors.generic);
      }
    });
  }

  function handleEditPasajeConfirm(diasViaje: string[], comentario: string) {
    if (!editPasajeTarget) return;
    const item = editPasajeTarget;
    setEditPasajeTarget(null);
    setActionError('');
    setActionNotice('');
    startTransition(async () => {
      try {
        const result = await editarFechasPasaje(item.data.id, comentario, diasViaje);
        setActionNotice(
          result.emailSent ? copy.aprobadas.messages.editSuccess : copy.aprobadas.messages.emailFailed
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : copy.aprobadas.errors.generic);
      }
    });
  }

  return (
    <>
      <div className="mb-4 max-w-xs">
        <Select
          label={copy.aprobadas.filtro.label}
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          options={[
            { value: '', label: copy.aprobadas.filtro.placeholder },
            ...employees.map((emp) => ({ value: emp.id, label: emp.label })),
          ]}
        />
      </div>

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

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral py-8 text-center">{copy.aprobadas.noItems}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-color-border">
                {[
                  copy.aprobadas.table.tipo,
                  copy.aprobadas.table.empleado,
                  copy.aprobadas.table.detalle,
                  copy.aprobadas.table.marca,
                  copy.aprobadas.table.acciones,
                ].map((h) => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium text-neutral uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-color-border">
              {filtered.map((item) => (
                <tr key={`${item.kind}-${item.data.id}`} className="hover:bg-surface/50 transition-colors">
                  <td className="py-3 px-3 font-medium text-secondary whitespace-nowrap">
                    {copy.aprobaciones.tipos[item.kind]}
                  </td>
                  <td className="py-3 px-3 text-neutral whitespace-nowrap">{itemEmpleadoNombre(item)}</td>
                  <td className="py-3 px-3 text-neutral">
                    <DetalleCell item={item} />
                  </td>
                  <td className="py-3 px-3">
                    <MarcaCell item={item} />
                  </td>
                  <td className="py-3 px-3">
                    {isVigente(item) && (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            item.kind === 'ausencia' ? setEditAusenciaTarget(item) : setEditPasajeTarget(item)
                          }
                          disabled={isPending}
                        >
                          {copy.aprobadas.actions.editarFechas}
                        </Button>
                        <Button variant="secondary" onClick={() => setCancelTarget(item)} disabled={isPending}>
                          {copy.aprobadas.actions.cancelar}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CancelModal
        item={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelConfirm}
        isPending={isPending}
      />
      <EditAusenciaModal
        item={editAusenciaTarget}
        onClose={() => setEditAusenciaTarget(null)}
        onConfirm={handleEditAusenciaConfirm}
        isPending={isPending}
      />
      <EditPasajeModal
        item={editPasajeTarget}
        onClose={() => setEditPasajeTarget(null)}
        onConfirm={handleEditPasajeConfirm}
        isPending={isPending}
      />
    </>
  );
}
