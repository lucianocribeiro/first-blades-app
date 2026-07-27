import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { SolicitudAusenciaForm } from './SolicitudAusenciaForm';
import { MisSolicitudesTable } from './MisSolicitudesTable';
import {
  computeSaldoDiasTramite,
  getYearRange,
  type DiaTramiteRow,
} from '@/lib/rotation/saldo-dias-tramite';
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

  // FB-F3-21: saldo de días de trámite del año en curso, derivado del
  // calendario (rotation_assignments), no de ausencia_requests — la fuente
  // de consumo real es lo que quedó asentado en el roster, no la solicitud
  // en sí (una solicitud pendiente todavía no consume nada).
  const { start: yearStart, end: yearEnd } = getYearRange();
  const { data: diasTramiteRaw, error: saldoError } = await supabase
    .from('rotation_assignments')
    .select('user_id, fecha, es_estimado')
    .eq('user_id', profile.id)
    .eq('motivo_ausencia', 'dia_tramite')
    .gte('fecha', yearStart)
    .lte('fecha', yearEnd);

  if (saldoError) {
    console.error('[SolicitudAusenciaPage] error al cargar el saldo de días de trámite:', saldoError.message);
    return (
      <Card>
        <p className="text-error text-sm">{copy.errors.generic}</p>
      </Card>
    );
  }

  const [saldo] = computeSaldoDiasTramite(
    [{ id: profile.id, full_name: profile.full_name, email: profile.email }],
    (diasTramiteRaw ?? []) as DiaTramiteRow[]
  );

  return (
    <div className="space-y-6">
      <SolicitudAusenciaForm saldo={saldo} />
      <MisSolicitudesTable requests={requests} />
    </div>
  );
}
