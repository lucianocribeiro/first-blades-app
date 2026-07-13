'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { upsertRotationAssignment } from './actions';
import { computeDefaultEsEstimado, validateAssignmentInput } from './utils';
import type { EstadoDia, MotivoAusencia, RotationAssignment } from '@/lib/db-types';
import type { RosterEmployee } from './RosterGrid';

type CellEditModalProps = {
  employee: RosterEmployee;
  fecha: string;
  assignment: RotationAssignment | undefined;
  onClose: () => void;
};

// Exportados para que RangeEditModal (FB-F3-23) reuse la misma fuente de
// opciones en vez de duplicar el mapeo enum → copy.
export const ESTADO_OPTIONS: { value: EstadoDia; label: string }[] = [
  { value: 'trabajando', label: copy.status.trabajando },
  { value: 'en_viaje', label: copy.status.en_viaje },
  { value: 'en_franco', label: copy.status.en_franco },
  { value: 'periodo_fuera_trabajo', label: copy.status.periodo_fuera_trabajo },
];

export const MOTIVO_OPTIONS: { value: MotivoAusencia; label: string }[] = [
  { value: 'vacaciones', label: copy.calendario.motivos.vacaciones },
  { value: 'licencia_medica', label: copy.calendario.motivos.licencia_medica },
  { value: 'dia_tramite', label: copy.calendario.motivos.dia_tramite },
  { value: 'matrimonio', label: copy.calendario.motivos.matrimonio },
  { value: 'fallecimiento', label: copy.calendario.motivos.fallecimiento },
  { value: 'otros', label: copy.calendario.motivos.otros },
];

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export function CellEditModal({ employee, fecha, assignment, onClose }: CellEditModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [estadoDia, setEstadoDia] = useState<EstadoDia>(assignment?.estado_dia ?? 'trabajando');
  const [motivoAusencia, setMotivoAusencia] = useState<MotivoAusencia | ''>(
    assignment?.motivo_ausencia ?? ''
  );
  const [motivoOtrosTexto, setMotivoOtrosTexto] = useState(assignment?.motivo_otros_texto ?? '');
  const [esEstimado, setEsEstimado] = useState(
    assignment?.es_estimado ?? computeDefaultEsEstimado(fecha, getToday())
  );

  const isFueraTrabajo = estadoDia === 'periodo_fuera_trabajo';
  const isOtros = motivoAusencia === 'otros';
  const nombre = employee.full_name || employee.email;

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
        await upsertRotationAssignment({
          user_id: employee.id,
          fecha,
          estado_dia: estadoDia,
          es_estimado: esEstimado,
          motivo_ausencia: motivoAusenciaValue,
          motivo_otros_texto: motivoOtrosValue,
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.calendario.messages.upsertError);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.calendario.modal.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" type="submit" form="cell-edit-form" loading={isPending}>
            {copy.calendario.modal.guardar}
          </Button>
        </>
      }
    >
      <form id="cell-edit-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="text-sm text-neutral">
          <p className="font-medium text-secondary">{nombre}</p>
          <p>{fecha}</p>
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

        <label className="flex items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={esEstimado}
            onChange={(e) => setEsEstimado(e.target.checked)}
            className="rounded border-color-border text-primary focus:ring-primary"
          />
          {copy.calendario.modal.fields.estimado}
        </label>
        <p className="text-xs text-neutral -mt-2">{copy.calendario.modal.hints.estimado}</p>

        {error && (
          <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
