'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { MOTIVO_OPTIONS } from '@/lib/rotation/motivo-options';
import { SaldoDiasTramiteCard } from './SaldoDiasTramiteCard';
import { validateAusenciaRequestInput } from './logic';
import { createAusenciaRequest } from './actions';
import type { MotivoAusencia } from '@/lib/db-types';
import type { SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';

type Props = {
  saldo: SaldoDiasTramite;
};

export function SolicitudAusenciaForm({ saldo }: Props) {
  const [isPending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState<MotivoAusencia | ''>('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [motivoOtrosTexto, setMotivoOtrosTexto] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const isDiaTramite = motivo === 'dia_tramite';
  const isOtros = motivo === 'otros';
  // Un día de trámite es un rango de un solo día: fecha_fin sigue a
  // fecha_inicio automáticamente, sin pedirle al usuario un segundo campo.
  const fechaFinEfectiva = isDiaTramite ? fechaInicio : fechaFin;

  function handleMotivoChange(value: MotivoAusencia) {
    setMotivo(value);
  }

  function resetForm() {
    setMotivo('');
    setFechaInicio('');
    setFechaFin('');
    setMotivoOtrosTexto('');
    setNota('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);

    const result = validateAusenciaRequestInput({
      motivo,
      fechaInicio,
      fechaFin: fechaFinEfectiva,
      motivoOtrosTexto,
    });

    if (!result.valid) {
      setError(result.error);
      return;
    }

    startTransition(async () => {
      // FB-F4-16: createAusenciaRequest devuelve { ok, error } en vez de
      // tirar — Next.js redacta el mensaje de un throw que cruce el límite
      // de una Server Action en build de producción.
      const result = await createAusenciaRequest({
        motivo:           motivo as MotivoAusencia,
        fechaInicio,
        fechaFin:         fechaFinEfectiva,
        motivoOtrosTexto: isOtros ? motivoOtrosTexto.trim() : undefined,
        nota:             nota.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      setSuccess(true);
    });
  }

  return (
    <>
      <Card>
        <h3 className="text-base font-semibold text-secondary mb-4">
          {copy.solicitudAusencia.formTitle}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <InfoBanner message={copy.purgatorio.infoMessage} />

          <Select
            label={copy.solicitudAusencia.fields.motivo}
            value={motivo}
            onChange={(e) => handleMotivoChange(e.target.value as MotivoAusencia)}
            options={MOTIVO_OPTIONS}
            placeholder={copy.solicitudAusencia.placeholders.motivo}
            required
          />

          <DatePicker
            label={copy.solicitudAusencia.fields.fechaInicio}
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            required
          />

          {!isDiaTramite && (
            <DatePicker
              label={copy.solicitudAusencia.fields.fechaFin}
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
              required
            />
          )}

          {isOtros && (
            <Input
              label={copy.solicitudAusencia.fields.motivoOtros}
              value={motivoOtrosTexto}
              onChange={(e) => setMotivoOtrosTexto(e.target.value)}
              placeholder={copy.solicitudAusencia.placeholders.motivoOtros}
              maxLength={80}
              required
            />
          )}

          <Textarea
            label={copy.solicitudAusencia.fields.nota}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={copy.solicitudAusencia.placeholders.nota}
            maxLength={240}
          />

          {error && (
            <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {copy.solicitudAusencia.messages.success}
            </p>
          )}

          <Button type="submit" variant="primary" loading={isPending}>
            {isPending ? copy.solicitudAusencia.messages.enviando : copy.solicitudAusencia.submitButton}
          </Button>
        </form>
      </Card>

      {isDiaTramite && <SaldoDiasTramiteCard saldo={saldo} />}
    </>
  );
}
