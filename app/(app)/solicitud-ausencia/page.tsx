import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { SolicitudAusenciaForm } from './SolicitudAusenciaForm';
import { MisSolicitudesTable } from './MisSolicitudesTable';
import type { AusenciaRequest } from '@/lib/db-types';

export default async function SolicitudAusenciaPage() {
  const profile = await requireAuth();

  // Admin entra en modo consulta (no envía); gestiona estas solicitudes desde /aprobaciones (FB-F3-19).
  if (profile.role === 'admin') {
    return (
      <Card>
        <InfoBanner message={copy.solicitudAusencia.adminConsulta.message} />
        <div className="mt-4">
          <Link href="/aprobaciones" className="text-sm font-medium text-primary hover:underline">
            {copy.solicitudAusencia.adminConsulta.linkLabel}
          </Link>
        </div>
      </Card>
    );
  }

  const supabase = await createServerClient();

  // RLS ya filtra por dueño/equipo; se agrega el filtro de app explícito
  // para que "mis solicitudes" muestre únicamente las propias.
  const { data, error } = await supabase
    .from('ausencia_requests')
    .select('*')
    .eq('user_id', profile.id)
    .order('fecha_inicio', { ascending: false });

  if (error) {
    console.error('[SolicitudAusenciaPage] error al cargar solicitudes:', error.message);
    return (
      <Card>
        <p className="text-error text-sm">{copy.errors.generic}</p>
      </Card>
    );
  }

  const requests = (data ?? []) as AusenciaRequest[];

  return (
    <div className="space-y-6">
      <SolicitudAusenciaForm />
      <MisSolicitudesTable requests={requests} />
    </div>
  );
}
