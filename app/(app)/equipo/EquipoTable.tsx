'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import { ROLE_LABELS } from '@/lib/roles';
import type { ProfileWithDocCounts } from './utils';
import type { Enums } from '@/supabase/types';

type Props = {
  profiles: ProfileWithDocCounts[];
};

const STATUS_OPTIONS = [
  { value: '', label: copy.equipo.todoEstado },
  { value: 'activo', label: copy.status.activo },
  { value: 'inactivo', label: copy.status.inactivo },
  { value: 'pendiente', label: copy.status.pendiente },
];

export function EquipoTable({ profiles }: Props) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const q = search.trim().toLowerCase();

  const filtered = profiles.filter((p) => {
    const matchesSearch =
      q.length === 0 ||
      (p.full_name ?? '').toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q);
    const matchesStatus =
      filterStatus === '' || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const t = copy.equipo;

  const columns = [
    {
      key: 'nombre',
      header: t.table.nombre,
      sticky: true,
      render: (p: ProfileWithDocCounts) => (
        <Link
          href={`/admin/empleado/${p.id}`}
          className="font-medium text-primary hover:underline"
        >
          {p.full_name || '—'}
        </Link>
      ),
    },
    {
      key: 'email',
      header: t.table.email,
      render: (p: ProfileWithDocCounts) => (
        <span className="text-neutral">{p.email}</span>
      ),
    },
    {
      key: 'rol',
      header: t.table.rol,
      render: (p: ProfileWithDocCounts) => (
        <span className="text-xs font-medium text-secondary">
          {ROLE_LABELS[p.role as Enums<'user_role'>]}
        </span>
      ),
    },
    {
      key: 'supervisor',
      header: t.table.supervisor,
      render: (p: ProfileWithDocCounts) => (
        <span className="text-neutral">{p.supervisor_name ?? '—'}</span>
      ),
    },
    {
      key: 'estado',
      header: t.table.estado,
      render: (p: ProfileWithDocCounts) => (
        <StatusBadge status={p.status as Enums<'employee_status'>} />
      ),
    },
    {
      key: 'docVencidos',
      header: t.table.docVencidos,
      render: (p: ProfileWithDocCounts) => (
        <span
          className={
            p.doc_vencidos > 0
              ? 'font-semibold text-error'
              : 'text-neutral'
          }
        >
          {p.doc_vencidos}
        </span>
      ),
    },
    {
      key: 'docPorVencer',
      header: t.table.docPorVencer,
      render: (p: ProfileWithDocCounts) => (
        <span
          className={
            p.doc_por_vencer > 0
              ? 'font-semibold text-warning'
              : 'text-neutral'
          }
        >
          {p.doc_por_vencer}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder={t.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={15} />}
          />
        </div>
        <div className="sm:w-48">
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={filtered}
        keyExtractor={(p) => p.id}
        emptyMessage={t.noPerfiles}
      />
    </div>
  );
}
