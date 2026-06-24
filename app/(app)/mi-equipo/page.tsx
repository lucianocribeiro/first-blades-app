import Link from 'next/link';
import { requireSupervisor } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { copy } from '@/lib/copy';
import { ROLE_LABELS } from '@/lib/roles';
import type { Enums } from '@/supabase/types';

type TeamMember = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  status: string;
  role: string;
};

export default async function MiEquipoPage() {
  const profile = await requireSupervisor();
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, status, role')
    .eq('supervisor_id', profile.id)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('[MiEquipoPage] error al cargar equipo:', error.message);
    return (
      <Card>
        <p className="text-error">{copy.errors.generic}</p>
      </Card>
    );
  }

  const members = (data ?? []) as TeamMember[];
  const t = copy.miEquipo;

  const columns = [
    {
      key: 'nombre',
      header: t.table.nombre,
      sticky: true,
      render: (m: TeamMember) => (
        <Link
          href={`/mi-equipo/${m.id}`}
          className="font-medium text-primary hover:underline"
        >
          {m.full_name || t.detalle.sinDatos}
        </Link>
      ),
    },
    {
      key: 'email',
      header: t.table.email,
      render: (m: TeamMember) => (
        <span className="text-neutral">{m.email}</span>
      ),
    },
    {
      key: 'telefono',
      header: t.table.telefono,
      render: (m: TeamMember) => (
        <span className="text-neutral">{m.phone ?? t.detalle.sinDatos}</span>
      ),
    },
    {
      key: 'estado',
      header: t.table.estado,
      render: (m: TeamMember) => (
        <StatusBadge status={m.status as Enums<'employee_status'>} />
      ),
    },
    {
      key: 'rol',
      header: t.table.rol,
      render: (m: TeamMember) => (
        <span className="text-xs font-medium text-secondary">
          {ROLE_LABELS[m.role as Enums<'user_role'>]}
        </span>
      ),
    },
  ];

  return (
    <Card padding="sm">
      <Table
        columns={columns}
        rows={members}
        keyExtractor={(m) => m.id}
        emptyMessage={t.noMiembros}
      />
    </Card>
  );
}
