'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
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

const statusOptions = [
  { value: 'activo',    label: copy.status.activo },
  { value: 'inactivo',  label: copy.status.inactivo },
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
  const [status, setStatus] = useState<Enums<'employee_status'>>(editingUser?.status ?? 'activo');
  const [password, setPassword] = useState('');

  function handleClose() {
    setError('');
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    startTransition(async () => {
      try {
        if (isEdit) {
          const input: UpdateUserInput = {
            id: editingUser.id,
            full_name: fullName,
            role,
            status,
            supervisor_id: role === 'empleado' ? supervisorId || undefined : undefined,
          };
          await updateUser(input);
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
          await createUser(input);
        }
        handleClose();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : isEdit
            ? copy.gestionUsuarios.messages.updateError
            : copy.gestionUsuarios.messages.createError
        );
      }
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
          <Select
            label={copy.gestionUsuarios.form.status}
            value={status}
            onChange={(e) => setStatus(e.target.value as Enums<'employee_status'>)}
            options={statusOptions}
            required
          />
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
