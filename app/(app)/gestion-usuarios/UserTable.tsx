'use client';

import { useState, useTransition } from 'react';
import { Pencil, UserX, UserCheck } from 'lucide-react';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { copy } from '@/lib/copy';
import { ROLE_LABELS } from '@/lib/roles';
import { setUserStatus } from './actions';
import { UserFormModal } from './UserFormModal';
import type { Tables } from '@/supabase/types';

type Supervisor = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'>;

type UserTableProps = {
  users: Tables<'profiles'>[];
  supervisors: Supervisor[];
};

export function UserTable({ users, supervisors }: UserTableProps) {
  const [editingUser, setEditingUser] = useState<Tables<'profiles'> | null>(null);
  const [isPending, startTransition] = useTransition();

  function supervisorName(supervisorId: string | null) {
    if (!supervisorId) return '—';
    const sup = supervisors.find((s) => s.id === supervisorId);
    return sup?.full_name || sup?.email || '—';
  }

  function handleToggleStatus(user: Tables<'profiles'>) {
    const next = user.status === 'activo' ? 'inactivo' : 'activo';
    startTransition(async () => {
      await setUserStatus(user.id, next);
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
            icon={
              u.status === 'activo' ? (
                <UserX size={14} className="text-error" />
              ) : (
                <UserCheck size={14} className="text-success" />
              )
            }
            onClick={() => handleToggleStatus(u)}
            loading={isPending}
            className="px-2 py-1 text-xs"
          >
            {u.status === 'activo'
              ? copy.gestionUsuarios.deactivate
              : copy.gestionUsuarios.activate}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
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
    </>
  );
}
