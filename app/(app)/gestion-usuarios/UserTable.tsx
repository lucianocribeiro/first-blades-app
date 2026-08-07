'use client';

import { useState, useTransition } from 'react';
import { Pencil, UserX, UserCheck, KeyRound } from 'lucide-react';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { copy } from '@/lib/copy';
import { ROLE_LABELS } from '@/lib/roles';
import { activateUser } from './actions';
import { UserFormModal } from './UserFormModal';
import { BajaModal } from './BajaModal';
import { ResetPasswordModal } from './ResetPasswordModal';
import type { Tables } from '@/supabase/types';

type Supervisor = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'>;

type UserTableProps = {
  users: Tables<'profiles'>[];
  supervisors: Supervisor[];
};

export function UserTable({ users, supervisors }: UserTableProps) {
  const [editingUser, setEditingUser] = useState<Tables<'profiles'> | null>(null);
  const [bajaTarget, setBajaTarget] = useState<Tables<'profiles'> | null>(null);
  const [resetTarget, setResetTarget] = useState<Tables<'profiles'> | null>(null);
  const [activateError, setActivateError] = useState('');
  const [isPending, startTransition] = useTransition();

  function supervisorName(supervisorId: string | null) {
    if (!supervisorId) return '—';
    const sup = supervisors.find((s) => s.id === supervisorId);
    return sup?.full_name || sup?.email || '—';
  }

  function userLabel(user: Tables<'profiles'>) {
    return user.full_name || user.email;
  }

  function handleActivate(user: Tables<'profiles'>) {
    setActivateError('');
    startTransition(async () => {
      const result = await activateUser(user.id);
      if (!result.ok) setActivateError(result.error);
    });
  }

  const columns = [
    {
      key: 'nombre',
      header: copy.gestionUsuarios.table.nombre,
      render: (u: Tables<'profiles'>) => (
        <span className="font-medium text-secondary">
          {u.full_name || '—'}
        </span>
      ),
    },
    {
      key: 'email',
      header: copy.gestionUsuarios.table.email,
      render: (u: Tables<'profiles'>) => u.email,
    },
    {
      key: 'rol',
      header: copy.gestionUsuarios.table.rol,
      render: (u: Tables<'profiles'>) => (
        <span className="text-xs font-medium text-secondary">
          {ROLE_LABELS[u.role]}
        </span>
      ),
    },
    {
      key: 'supervisor',
      header: copy.gestionUsuarios.table.supervisor,
      render: (u: Tables<'profiles'>) => supervisorName(u.supervisor_id),
    },
    {
      key: 'estado',
      header: copy.gestionUsuarios.table.estado,
      render: (u: Tables<'profiles'>) => <StatusBadge status={u.status} />,
    },
    {
      key: 'acciones',
      header: copy.gestionUsuarios.table.acciones,
      render: (u: Tables<'profiles'>) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            icon={<Pencil size={14} />}
            onClick={() => setEditingUser(u)}
            className="px-2 py-1 text-xs"
          >
            {copy.general.edit}
          </Button>
          <Button
            variant="ghost"
            icon={<KeyRound size={14} />}
            onClick={() => setResetTarget(u)}
            className="px-2 py-1 text-xs"
          >
            {copy.gestionUsuarios.resetPassword.action}
          </Button>
          {u.status === 'activo' ? (
            <Button
              variant="ghost"
              icon={<UserX size={14} className="text-error" />}
              onClick={() => setBajaTarget(u)}
              className="px-2 py-1 text-xs"
            >
              {copy.gestionUsuarios.deactivate}
            </Button>
          ) : (
            <Button
              variant="ghost"
              icon={<UserCheck size={14} className="text-success" />}
              onClick={() => handleActivate(u)}
              loading={isPending}
              className="px-2 py-1 text-xs"
            >
              {copy.gestionUsuarios.activate}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {activateError && (
        <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          {activateError}
        </p>
      )}

      <Table
        columns={columns}
        rows={users}
        keyExtractor={(u) => u.id}
        emptyMessage={copy.gestionUsuarios.messages.noUsers}
      />

      {editingUser && (
        <UserFormModal
          open={!!editingUser}
          onClose={() => setEditingUser(null)}
          editingUser={editingUser}
          supervisors={supervisors}
        />
      )}

      {bajaTarget && (
        <BajaModal
          open={!!bajaTarget}
          onClose={() => setBajaTarget(null)}
          userId={bajaTarget.id}
          userLabel={userLabel(bajaTarget)}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          open={!!resetTarget}
          onClose={() => setResetTarget(null)}
          userId={resetTarget.id}
          userLabel={userLabel(resetTarget)}
        />
      )}
    </>
  );
}
