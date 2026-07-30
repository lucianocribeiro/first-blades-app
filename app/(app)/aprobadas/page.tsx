import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { AprobadasTable, type AprobadaItem } from './AprobadasTable';
import type { AusenciaRequest, PasajeRequest, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type AusenciaWithUser = AusenciaRequest & { user_profile?: UserProfilePick | null };
type PasajeWithUser = PasajeRequest & {
  solicitante_profile?: UserProfilePick | null;
  empleado_profile?: UserProfilePick | null;
};

export type { AusenciaWithUser, PasajeWithUser };

export default async function AprobadasPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  // Aprobadas de ambas tablas — la RPC (0017) es la que mantiene el marcador
  // post_aprobacion_tipo/comentario/timestamp; acá solo se lee y se lista.
  // 'cancelar_editar_*' mantiene estado='aprobado' incluso tras cancelar (la
  // cancelación es un overlay, no un cambio de estado) — así que el filtro
  // es simplemente estado='aprobado', sin excluir canceladas: siguen siendo
  // parte del historial de aprobadas, solo que ya no son "vigentes" para
  // volver a tocar (la RPC las rechaza; la UI las muestra sin acciones).
  const [ausenciasResult, pasajesResult] = await Promise.all([
    supabase
      .from('ausencia_requests')
      .select('*, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)')
      .eq('estado', 'aprobado')
      .order('reviewed_at', { ascending: false }),
    supabase
      .from('pasaje_requests')
      .select(
        '*, solicitante_profile:profiles!pasaje_requests_solicitante_id_fkey(full_name, email), empleado_profile:profiles!pasaje_requests_empleado_id_fkey(full_name, email)'
      )
      .eq('estado', 'aprobado')
      .order('reviewed_at', { ascending: false }),
  ]);

  const error = ausenciasResult.error || pasajesResult.error;

  if (error) {
    console.error('[AprobadasPage] error al cargar solicitudes aprobadas:', error.message);
    return (
      <Card>
        <p className="text-error text-sm">{copy.errors.generic}</p>
      </Card>
    );
  }

  const ausencias = ((ausenciasResult.data as AusenciaWithUser[] | null) ?? []).map(
    (data): AprobadaItem => ({ kind: 'ausencia', data })
  );
  const pasajes = ((pasajesResult.data as PasajeWithUser[] | null) ?? []).map(
    (data): AprobadaItem => ({ kind: 'pasaje', data })
  );

  const items = [...ausencias, ...pasajes].sort((a, b) => {
    const ra = a.data.reviewed_at ?? '';
    const rb = b.data.reviewed_at ?? '';
    return rb.localeCompare(ra);
  });

  // Lista de empleados para el filtro — derivada de los propios ítems (no
  // todos los perfiles del portal), así que solo aparecen empleados que
  // efectivamente tienen alguna aprobada.
  const employeeMap = new Map<string, string>();
  for (const item of items) {
    const id = item.kind === 'ausencia' ? item.data.user_id : item.data.empleado_id;
    const profile = item.kind === 'ausencia' ? item.data.user_profile : item.data.empleado_profile;
    const label = profile?.full_name || profile?.email || id;
    if (!employeeMap.has(id)) employeeMap.set(id, label);
  }
  const employees = [...employeeMap.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es-AR'));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-secondary">{copy.aprobadas.title}</h2>
          <p className="text-sm text-neutral mt-0.5">{copy.aprobadas.subtitle}</p>
        </div>
        <Link href="/aprobaciones" className="text-sm font-medium text-primary hover:underline whitespace-nowrap">
          {copy.aprobadas.volverAprobaciones}
        </Link>
      </div>

      <Card padding="sm">
        <AprobadasTable items={items} employees={employees} />
      </Card>
    </div>
  );
}
