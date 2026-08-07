'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { copy } from '@/lib/copy';
import { validatePassword } from '@/lib/password';
import { resetPassword } from './actions';

type ResetPasswordModalProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
  userLabel: string;
};

export function ResetPasswordModal({ open, onClose, userId, userLabel }: ResetPasswordModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);

  function handleClose() {
    setPassword('');
    setError('');
    onClose();
  }

  async function handleConfirm() {
    const check = validatePassword(password);
    if (!check.valid) {
      setError(check.error!);
      return;
    }

    setIsPending(true);
    const result = await resetPassword(userId, password);
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
      title={copy.gestionUsuarios.resetPassword.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isPending}>
            {copy.gestionUsuarios.resetPassword.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-neutral">
          {userLabel} — {copy.gestionUsuarios.resetPassword.description}
        </p>
        <Input
          label={copy.gestionUsuarios.resetPassword.passwordLabel}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          required
          autoComplete="new-password"
        />
      </div>
    </Modal>
  );
}
