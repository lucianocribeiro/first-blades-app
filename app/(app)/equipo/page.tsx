import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';
import { EquipoTable } from './EquipoTable';
import { ProximosAVencer } from './ProximosAVencer';
import {
  buildSupervisorMap,
  computeDocCounts,
  buildProfilesWithCounts,
  buildProximosAVencer,
} from './utils';
import type { ProfileRow, DocRow } from './utils';

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export default async function EquipoPage() {
  await requireAdmin();

  const supabase = await createServerClient();
  const today = getToday();

  const [profilesResult, docsResult] = await Promise.all([
    supabase.from('profiles').select('*').order('full_name', { ascending: true }),
    supabase
      .from('documents')
      .select('id, user_id, document_type, certificado_tipo, certificado_otros_texto, fecha_vencimiento')
      .eq('estado', 'aprobado')
      .not('fecha_vencimiento', 'is', null),
  ]);

  if (profilesResult.error) {
    console.error('[EquipoPage] error al cargar perfiles:', profilesResult.error.message);
    return (
      <Card>
        <p className="text-error">{copy.errors.generic}</p>
      </Card>
    );
  }

  if (docsResult.error) {
    console.error('[EquipoPage] error al cargar documentos:', docsResult.error.message);
  }

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const docs = ((docsResult.data ?? []) as (DocRow & { fecha_vencimiento: string | null })[])
    .filter((d): d is DocRow => d.fecha_vencimiento !== null);

  const supervisorMap = buildSupervisorMap(profiles);
  const docCounts = computeDocCounts(docs, today);
  const profilesWithCounts = buildProfilesWithCounts(profiles, docCounts, supervisorMap);
  const proximos = buildProximosAVencer(docs, profiles, today);

  return (
    <div className="space-y-6">
      <ProximosAVencer rows={proximos} />

      <Card padding="sm">
        <EquipoTable profiles={profilesWithCounts} />
      </Card>
    </div>
  );
}
