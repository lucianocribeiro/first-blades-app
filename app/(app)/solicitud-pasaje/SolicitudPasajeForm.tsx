'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { MOTIVO_VIAJE_OPTIONS } from '@/lib/rotation/motivo-viaje-options';
import { validatePasajeRequestInput } from './logic';
import { createPasajeRequest } from './actions';
import type { MotivoViaje } from '@/lib/db-types';

export type TeamMember = { id: string; full_name: string | null; email: string };

type Props = {
  // Equipo del supervisor (+ sí mismo), para el selector de "para quién".
  // Vacío y sin usarse cuando showEmpleadoSelector es false (rol empleado).
  team: TeamMember[];
  showEmpleadoSelector: boolean;
};

export function SolicitudPasajeForm({ team, showEmpleadoSelector }: Props) {
  const [isPending, startTransition] = useTransition();
  const [empleadoId, setEmpleadoId] = useState('');
  const [motivoViaje, setMotivoViaje] = useState<MotivoViaje | ''>('');
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [diasViaje, setDiasViaje] = useState<string[]>(['']);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const teamOptions = team.map((m) => ({ value: m.id, label: m.full_name || m.email }));

  function resetForm() {
    setEmpleadoId('');
    setMotivoViaje('');
    setOrigen('');
    setDestino('');
    setDiasViaje(['']);
    setNota('');
  }

  function handleDiaChange(index: number, value: string) {
    setDiasViaje((prev) => prev.map((dia, i) => (i === index ? value : dia)));
  }

  function handleAddDia() {
    setDiasViaje((prev) => [...prev, '']);
  }

  function handleRemoveDia(index: number) {
    setDiasViaje((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (showEmpleadoSelector && !empleadoId) {
      setError(copy.solicitudPasaje.errors.empleadoRequerido);
      return;
    }

    // Filas de fecha vacías (el usuario agregó una fila pero no la completó)
    // no cuentan como días de viaje.
    const diasCompletos = diasViaje.filter((dia) => dia !== '');

    const result = validatePasajeRequestInput({
      motivoViaje,
      origen,
      destino,
      diasViaje: diasCompletos,
    });

    if (!result.valid) {
      setError(result.error);
      return;
    }

    startTransition(async () => {
      // FB-F4-16: createPasajeRequest devuelve { ok, error } en vez de
      // tirar — Next.js redacta el mensaje de un throw que cruce el límite
      // de una Server Action en build de producción.
      const submitResult = await createPasajeRequest({
        empleadoId:  showEmpleadoSelector ? empleadoId : undefined,
        motivoViaje: motivoViaje as MotivoViaje,
        origen:      origen.trim(),
        destino:     destino.trim(),
        diasViaje:   diasCompletos,
        nota:        nota.trim() || undefined,
      });
      if (!submitResult.ok) {
        setError(submitResult.error);
        return;
      }
      resetForm();
      setSuccess(true);
    });
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary mb-4">
        {copy.solicitudPasaje.formTitle}
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <InfoBanner message={copy.purgatorio.infoMessage} />

        {showEmpleadoSelector && (
          <Select
            label={copy.solicitudPasaje.fields.empleado}
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            options={teamOptions}
            placeholder={copy.solicitudPasaje.placeholders.empleado}
            required
          />
        )}

        <Select
          label={copy.solicitudPasaje.fields.motivoViaje}
          value={motivoViaje}
          onChange={(e) => setMotivoViaje(e.target.value as MotivoViaje)}
          options={MOTIVO_VIAJE_OPTIONS}
          placeholder={copy.solicitudPasaje.placeholders.motivoViaje}
          required
        />

        <Input
          label={copy.solicitudPasaje.fields.origen}
          value={origen}
          onChange={(e) => setOrigen(e.target.value)}
          placeholder={copy.solicitudPasaje.placeholders.origen}
          required
        />

        <Input
          label={copy.solicitudPasaje.fields.destino}
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          placeholder={copy.solicitudPasaje.placeholders.destino}
          required
        />

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-secondary">
            {copy.solicitudPasaje.fields.diasViaje}
            <span className="text-error ml-1">*</span>
          </label>
          {diasViaje.map((dia, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1">
                <DatePicker
                  aria-label={`${copy.solicitudPasaje.fields.diasViaje} ${index + 1}`}
                  value={dia}
                  onChange={(e) => handleDiaChange(index, e.target.value)}
                />
              </div>
              {diasViaje.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRemoveDia(index)}
                  aria-label={copy.solicitudPasaje.diasViaje.quitarDia}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={handleAddDia} icon={<Plus size={16} />}>
            {copy.solicitudPasaje.diasViaje.agregarDia}
          </Button>
        </div>

        <Textarea
          label={copy.solicitudPasaje.fields.nota}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder={copy.solicitudPasaje.placeholders.nota}
          maxLength={240}
        />

        {error && (
          <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {copy.solicitudPasaje.messages.success}
          </p>
        )}

        <Button type="submit" variant="primary" loading={isPending}>
          {isPending ? copy.solicitudPasaje.messages.enviando : copy.solicitudPasaje.submitButton}
        </Button>
      </form>
    </Card>
  );
}
