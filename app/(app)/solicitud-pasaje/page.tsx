import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { SolicitudPasajeForm, type TeamMember } from './SolicitudPasajeForm';
import { MisSolicitudesPasajeTable } from './MisSolicitudesPasajeTable';
import type { PasajeRequest, Profile } from '@/lib/db-types';

type EmpleadoPick = Pick<Profile, 'full_name' | 'email'>;
export type PasajeRequestWithEmpleado = PasajeRequest & { empleado_profile?: EmpleadoPick | null };

export default async function SolicitudPasajePage() {
  const profile = await requireAuth();

  // Admin entra en modo consulta (no envía); gestiona estas solicitudes desde /aprobaciones.
  if (profile.role === 'admin') {
    return (
      <Card>
        <InfoBanner message={copy.solicitudPasaje.adminConsulta.message} />
        <div className="mt-4">
          <Link href="/aprobaciones" className="text-sm font-medium text-primary hover:underline">
            {copy.solicitudPasaje.adminConsulta.linkLabel}
          </Link>
        </div>
      </Card>
    );
  }

  const supabase = await createServerClient();

  // El selector de "para quién" solo aplica a supervisor: su equipo + sí
  // mismo (mismo patrón que el roster de calendario/page.tsx). Empleado no
  // ve el selector — pide siempre para sí, resuelto server-side en la action.
  let team: TeamMember[] = [];
  if (profile.role === 'supervisor') {
    const { data: teamRaw, error: teamError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'activo')
      .or(`id.eq.${profile.id},supervisor_id.eq.${profile.id}`)
      .order('full_name', { ascending: true });

    if (teamError) {
      console.error('[SolicitudPasajePage] error al cargar el equipo:', teamError.message);
      return (
        <Card>
          <p className="text-error text-sm">{copy.errors.generic}</p>
        </Card>
      );
    }
    team = (teamRaw ?? []) as TeamMember[];
  }

  // RLS ya filtra por dueño/equipo; se agrega el filtro de app explícito para
  // que "Mis solicitudes" muestre únicamente lo que YO envié como solicitante
  // (un supervisor puede enviar para un integrante de su equipo — la lista
  // sigue siendo "lo que pedí", no "lo que me pidieron a mí").
  const { data, error } = await supabase
    .from('pasaje_requests')
    .select('*, empleado_profile:profiles!pasaje_requests_empleado_id_fkey(full_name, email)')
    .eq('solicitante_id', profile.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[SolicitudPasajePage] error al cargar solicitudes:', error.message);
    return (
      <Card>
        <p className="text-error text-sm">{copy.errors.generic}</p>
      </Card>
    );
  }

  const requests = (data ?? []) as PasajeRequestWithEmpleado[];

  return (
    <div className="space-y-6">
      <SolicitudPasajeForm team={team} showEmpleadoSelector={profile.role === 'supervisor'} />
      <MisSolicitudesPasajeTable requests={requests} />
    </div>
  );
}
