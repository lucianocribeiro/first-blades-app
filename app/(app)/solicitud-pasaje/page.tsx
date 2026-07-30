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
export type PasajeRequestWithEmpleado = PasajeRequest & {
  empleado_profile?: EmpleadoPick | null;
  solicitante_profile?: EmpleadoPick | null;
};

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

  // RLS ya filtra por dueño/equipo (policy pasajes_select permite
  // solicitante_id = auth.uid() O empleado_id = auth.uid()); el filtro de app
  // explícito amplía "Mis solicitudes" a las DOS perspectivas — lo que YO
  // pedí (solicitante) y lo que ME pidieron a mí (empleado viajero, cuando
  // un supervisor pide para su equipo). FB-F4-15: antes solo filtraba por
  // solicitante_id, así que el empleado viajero nunca veía la fila (ni su
  // marca post-aprobación) cuando otra persona la había solicitado — recibía
  // el mail pero sin representación in-app (viola §2.4). Un solo .or() sobre
  // una tabla no duplica filas (no es una UNION de dos queries), así que la
  // fila donde solicitante_id = empleado_id = profile.id sigue apareciendo
  // una sola vez — no hace falta dedup explícito en JS.
  const { data, error } = await supabase
    .from('pasaje_requests')
    .select(
      '*, empleado_profile:profiles!pasaje_requests_empleado_id_fkey(full_name, email), solicitante_profile:profiles!pasaje_requests_solicitante_id_fkey(full_name, email)'
    )
    .or(`solicitante_id.eq.${profile.id},empleado_id.eq.${profile.id}`)
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
      <MisSolicitudesPasajeTable requests={requests} viewerId={profile.id} />
    </div>
  );
}
