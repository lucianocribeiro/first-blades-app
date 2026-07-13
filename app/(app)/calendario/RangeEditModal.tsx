'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { upsertRotationRange, type UpsertRotationRangeResult } from './actions';
import { validateAssignmentInput } from './utils';
import { ESTADO_OPTIONS, MOTIVO_OPTIONS as ALL_MOTIVO_OPTIONS } from './CellEditModal';
import type { EstadoDia, MotivoAusencia } from '@/lib/db-types';
import type { RosterEmployee } from './RosterGrid';

type RangeEditModalProps = {
  employee: RosterEmployee;
  fechas: string[];
  onClose: () => void;
};

// dia_tramite se gestiona por su propio flujo de Solicitud de Ausencia +
// aprobación (cupo incluido) — el pintado por rango no lo ofrece.
const MOTIVO_OPTIONS = ALL_MOTIVO_OPTIONS.filter((o) => o.value !== 'dia_tramite');

export function RangeEditModal({ employee, fechas, onClose }: RangeEditModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [report, setReport] = useState<UpsertRotationRangeResult | null>(null);
  const [estadoDia, setEstadoDia] = useState<EstadoDia>('trabajando');
  const [motivoAusencia, setMotivoAusencia] = useState<MotivoAusencia | ''>('');
  const [motivoOtrosTexto, setMotivoOtrosTexto] = useState('');

  const isFueraTrabajo = estadoDia === 'periodo_fuera_trabajo';
  const isOtros = motivoAusencia === 'otros';
  const nombre = employee.full_name || employee.email;
  const total = fechas.length;
  const primerDia = fechas[0];
  const ultimoDia = fechas[total - 1];
  const diasLabel = total === 1 ? copy.calendario.range.seleccion.diaSingular : copy.calendario.range.seleccion.diasPlural;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const motivoAusenciaValue = isFueraTrabajo ? (motivoAusencia || null) : null;
    const motivoOtrosValue = isOtros ? motivoOtrosTexto : null;

    const result = validateAssignmentInput({
      estado_dia: estadoDia,
      motivo_ausencia: motivoAusenciaValue,
      motivo_otros_texto: motivoOtrosValue,
    });

    if (!result.valid) {
      setError(result.error);
      return;
    }

    startTransition(async () => {
      try {
        const rangeResult = await upsertRotationRange({
          user_id: employee.id,
          fechas,
          estado_dia: estadoDia,
          motivo_ausencia: motivoAusenciaValue,
          motivo_otros_texto: motivoOtrosValue,
        });
        setReport(rangeResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.calendario.messages.upsertError);
      }
    });
  }

  if (report) {
    const allOk = report.failed.length === 0;
    const summary = allOk
      ? copy.calendario.range.resultado.todoOk
      : `${copy.calendario.range.resultado.aplicaronPrefijo} ${report.applied.length} ${copy.calendario.range.resultado.de} ${total} ${
          total === 1 ? copy.calendario.range.resultado.diaSingular : copy.calendario.range.resultado.diasPlural
        }.`;

    return (
      <Modal
        open
        onClose={onClose}
        title={copy.calendario.range.modal.title}
        size="sm"
        footer={
          <Button variant="primary" onClick={onClose}>
            {copy.calendario.range.modal.cerrar}
          </Button>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="font-medium text-secondary">{nombre}</p>
          <p className={allOk ? 'text-secondary' : 'text-error'}>{summary}</p>
          {!allOk && (
            <div>
              <p className="font-medium text-secondary">{copy.calendario.range.resultado.fallaronTitulo}</p>
              <ul className="list-disc pl-5 text-neutral">
                {report.failed.map((f) => (
                  <li key={f.fecha}>
                    {f.fecha}: {f.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.calendario.range.modal.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" type="submit" form="range-edit-form" loading={isPending}>
            {copy.calendario.range.modal.guardar}
          </Button>
        </>
      }
    >
      <form id="range-edit-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="text-sm text-neutral">
          <p className="font-medium text-secondary">{nombre}</p>
          <p>
            {copy.calendario.range.modal.rango}: {primerDia} – {ultimoDia} ({total} {diasLabel})
          </p>
          <p className="text-xs mt-1">{copy.calendario.modal.hints.estimado}</p>
        </div>

        <Select
          label={copy.calendario.modal.fields.estado}
          value={estadoDia}
          onChange={(e) => setEstadoDia(e.target.value as EstadoDia)}
          options={ESTADO_OPTIONS}
          required
        />

        {isFueraTrabajo && (
          <>
            <Select
              label={copy.calendario.modal.fields.motivo}
              value={motivoAusencia}
              onChange={(e) => setMotivoAusencia(e.target.value as MotivoAusencia)}
              options={MOTIVO_OPTIONS}
              placeholder={copy.calendario.modal.placeholders.motivo}
              required
            />
            {isOtros && (
              <Input
                label={copy.calendario.modal.fields.motivoOtros}
                value={motivoOtrosTexto}
                onChange={(e) => setMotivoOtrosTexto(e.target.value)}
                placeholder={copy.calendario.modal.placeholders.motivoOtros}
                maxLength={80}
                required
              />
            )}
          </>
        )}

        {error && (
          <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
