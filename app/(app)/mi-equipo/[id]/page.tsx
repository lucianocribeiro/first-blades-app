import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireSupervisor } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { copy } from '@/lib/copy';
import { ROLE_LABELS } from '@/lib/roles';
import type { Enums } from '@/supabase/types';

type MemberProfile = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  status: string;
  role: string;
};

export default async function MiEquipoMiembroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSupervisor();
  const { id } = await params;

  const supabase = await createServerClient();

  // RLS enforces team scope: if the id is not in the supervisor's team,
  // the query returns null and we notFound().
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, status, role')
    .eq('id', id)
    .single();

  if (error || !data) {
    notFound();
  }

  const member = data as MemberProfile;
  const t = copy.miEquipo;

  return (
    <div className="space-y-4">
      <Link
        href="/mi-equipo"
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <ArrowLeft size={14} />
        {t.detalle.backToList}
      </Link>

      <Card>
        <h2 className="text-base font-semibold text-secondary mb-6">
          {member.full_name || t.detalle.sinDatos}
        </h2>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <dt className="text-xs font-medium text-neutral uppercase tracking-wide mb-1">
              {t.campos.nombre}
            </dt>
            <dd className="text-sm text-secondary">
              {member.full_name || t.detalle.sinDatos}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-neutral uppercase tracking-wide mb-1">
              {t.campos.email}
            </dt>
            <dd className="text-sm text-secondary">{member.email}</dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-neutral uppercase tracking-wide mb-1">
              {t.campos.telefono}
            </dt>
            <dd className="text-sm text-secondary">
              {member.phone || t.detalle.sinDatos}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-neutral uppercase tracking-wide mb-1">
              {t.campos.rol}
            </dt>
            <dd className="text-sm text-secondary">
              {ROLE_LABELS[member.role as Enums<'user_role'>]}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-medium text-neutral uppercase tracking-wide mb-1">
              {t.campos.estado}
            </dt>
            <dd>
              <StatusBadge status={member.status as Enums<'employee_status'>} />
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
