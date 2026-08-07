'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { DatePicker } from '@/components/ui/DatePicker';
import { copy } from '@/lib/copy';
import { getBusinessToday } from '@/lib/business-date';
import { deactivateUser } from './actions';

type BajaModalProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
  userLabel: string;
};

export function BajaModal({ open, onClose, userId, userLabel }: BajaModalProps) {
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(getBusinessToday());
  const [motivoError, setMotivoError] = useState('');
  const [fechaError, setFechaError] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);

  function handleClose() {
    setMotivo('');
    setFecha(getBusinessToday());
    setMotivoError('');
    setFechaError('');
    setError('');
    onClose();
  }

  async function handleConfirm() {
    const trimmedMotivo = motivo.trim();
    const hasMotivoError = !trimmedMotivo;
    const hasFechaError = !fecha;

    setMotivoError(hasMotivoError ? copy.gestionUsuarios.bajaModal.motivoRequired : '');
    setFechaError(hasFechaError ? copy.gestionUsuarios.bajaModal.fechaRequired : '');
    if (hasMotivoError || hasFechaError) return;

    setError('');
    setIsPending(true);
    const result = await deactivateUser({ id: userId, motivo: trimmedMotivo, fecha });
    setIsPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    handleClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={copy.gestionUsuarios.bajaModal.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isPending}>
            {copy.gestionUsuarios.bajaModal.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-neutral">{userLabel}</p>
        <Textarea
          label={copy.gestionUsuarios.bajaModal.motivoLabel}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={copy.gestionUsuarios.bajaModal.motivoPlaceholder}
          rows={4}
          error={motivoError}
          required
        />
        <DatePicker
          label={copy.gestionUsuarios.bajaModal.fechaLabel}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          error={fechaError}
          required
        />
        {error && (
          <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
