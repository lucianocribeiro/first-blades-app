'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { Textarea } from '@/components/ui/Textarea';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { createDiaTramiteRequest } from './actions';

export function SolicitudAusenciaForm() {
  const [isPending, startTransition] = useTransition();
  const [fecha, setFecha] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!fecha) {
      setError(copy.solicitudAusencia.errors.fechaRequerida);
      return;
    }

    startTransition(async () => {
      try {
        await createDiaTramiteRequest({ fecha, nota: nota.trim() || undefined });
        setFecha('');
        setNota('');
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.errors.generic);
      }
    });
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary mb-4">
        {copy.solicitudAusencia.formTitle}
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <InfoBanner message={copy.purgatorio.infoMessage} />

        <DatePicker
          label={copy.solicitudAusencia.fields.fecha}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          required
        />

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
  );
}
