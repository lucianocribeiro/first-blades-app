'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { copy } from '@/lib/copy';
import { ROLE_LABELS } from '@/lib/roles';
import { createUser, updateUser } from './actions';
import type { CreateUserInput, UpdateUserInput } from './actions';
import type { Tables, Enums } from '@/supabase/types';

type Supervisor = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'>;

type UserFormModalProps = {
  open: boolean;
  onClose: () => void;
  editingUser?: Tables<'profiles'> | null;
  supervisors: Supervisor[];
};

const roleOptions = [
  { value: 'admin',      label: ROLE_LABELS.admin },
  { value: 'supervisor', label: ROLE_LABELS.supervisor },
  { value: 'empleado',   label: ROLE_LABELS.empleado },
];

export function UserFormModal({
  open,
  onClose,
  editingUser,
  supervisors,
}: UserFormModalProps) {
  const isEdit = !!editingUser;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const [fullName, setFullName] = useState(editingUser?.full_name ?? '');
  const [email, setEmail] = useState(editingUser?.email ?? '');
  const [role, setRole] = useState<Enums<'user_role'>>(editingUser?.role ?? 'empleado');
  const [supervisorId, setSupervisorId] = useState(editingUser?.supervisor_id ?? '');
  const [password, setPassword] = useState('');

  function handleClose() {
    setError('');
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    startTransition(async () => {
      if (isEdit) {
        const input: UpdateUserInput = {
          id: editingUser.id,
          full_name: fullName,
          role,
          supervisor_id: role === 'empleado' ? supervisorId || undefined : undefined,
        };
        const result = await updateUser(input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } else {
        if (!password) {
          setError(copy.gestionUsuarios.passwordRequired);
          return;
        }
        const input: CreateUserInput = {
          email,
          full_name: fullName,
          role,
          supervisor_id: role === 'empleado' ? supervisorId || undefined : undefined,
          initial_password: password,
        };
        const result = await createUser(input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      handleClose();
    });
  }

  const supervisorOptions = supervisors.map((s) => ({
    value: s.id,
    label: s.full_name || s.email,
  }));

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? copy.gestionUsuarios.editUser : copy.gestionUsuarios.createUser}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="user-form"
            loading={isPending}
          >
            {isEdit ? copy.general.update : copy.general.create}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={copy.gestionUsuarios.form.nombre}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          placeholder={copy.gestionUsuarios.form.nombrePlaceholder}
        />

        <Input
          label={copy.gestionUsuarios.form.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={!isEdit}
          readOnly={isEdit}
          placeholder={copy.auth.login.emailPlaceholder}
        />

        <Select
          label={copy.gestionUsuarios.form.rol}
          value={role}
          onChange={(e) => setRole(e.target.value as Enums<'user_role'>)}
          options={roleOptions}
          required
        />

        {role === 'empleado' && (
          <Select
            label={copy.gestionUsuarios.form.supervisor}
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            options={supervisorOptions}
            placeholder={copy.gestionUsuarios.form.supervisorPlaceholder}
            hint={copy.gestionUsuarios.form.supervisorHint}
          />
        )}

        {isEdit && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-secondary">
              {copy.gestionUsuarios.form.status}
            </span>
            <div>
              <StatusBadge status={editingUser.status} />
            </div>
          </div>
        )}

        {isEdit && editingUser.status === 'inactivo' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-secondary">
                {copy.gestionUsuarios.form.motivoBaja}
              </span>
              <p className="text-sm text-neutral">{editingUser.motivo_baja || '—'}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-secondary">
                {copy.gestionUsuarios.form.fechaBaja}
              </span>
              <p className="text-sm text-neutral">{editingUser.fecha_baja || '—'}</p>
            </div>
          </div>
        )}

        {!isEdit && (
          <Input
            label={copy.gestionUsuarios.form.password}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            hint={copy.gestionUsuarios.form.passwordHint}
            autoComplete="new-password"
          />
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
