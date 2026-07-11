import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { AprobacionesTable, type PendingItem } from './AprobacionesTable';
import {
  computeSaldoDiasTramite,
  getYearRange,
  type DiaTramiteRow,
  type SaldoDiasTramite,
} from '@/lib/rotation/saldo-dias-tramite';
import type { AusenciaRequest, Document, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type RawDocument = Document & { user_profile?: UserProfilePick | null };
type RawAusencia = AusenciaRequest & { user_profile?: UserProfilePick | null };

export default async function AprobacionesPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  // Bandeja única: documentos pendientes + días de trámite pendientes, cada
  // uno con join a profiles para mostrar el nombre del solicitante.
  const [docsResult, ausenciasResult] = await Promise.all([
    supabase
      .from('documents')
      .select('*, user_profile:profiles!documents_user_id_fkey(full_name, email)')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true }),
    supabase
      .from('ausencia_requests')
      .select('*, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)')
      .eq('estado', 'pendiente')
      .eq('motivo_ausencia', 'dia_tramite')
      .order('created_at', { ascending: true }),
  ]);

  const error = docsResult.error || ausenciasResult.error;

  const documents = ((docsResult.data as RawDocument[] | null) ?? []).map(
    (doc): PendingItem => ({ kind: 'documento', data: doc })
  );
  const ausencias = ((ausenciasResult.data as RawAusencia[] | null) ?? []).map(
    (req): PendingItem => ({ kind: 'ausencia', data: req })
  );

  const items = [...documents, ...ausencias].sort((a, b) =>
    a.data.created_at.localeCompare(b.data.created_at)
  );

  // FB-F3-21: badge de saldo por solicitante en la cola (seam dejado en
  // FB-F3-19/20). No bloquea la aprobación — es informativo, para que el
  // admin decida con el consumo real del año a la vista. Se deriva del
  // calendario (rotation_assignments), no de las solicitudes pendientes en
  // sí (una solicitud pendiente todavía no consumió nada).
  const solicitanteIds = [...new Set(ausencias.map((item) => item.data.user_id))];
  let saldoByUser = new Map<string, SaldoDiasTramite>();
  // FB-F3-22: si falla la query, la ausencia de badge NO puede leerse como
  // "sin días consumidos" (dato válido) — eso ocultaría la falla y podría
  // llevar al admin a aprobar sobre un supuesto falso. Se señaliza aparte
  // para que la tabla muestre un estado de error visible, no silencio.
  let saldoLoadFailed = false;
  if (solicitanteIds.length > 0) {
    const { start: yearStart, end: yearEnd } = getYearRange();
    const { data: diasTramiteRaw, error: saldoError } = await supabase
      .from('rotation_assignments')
      .select('user_id, fecha, es_estimado')
      .in('user_id', solicitanteIds)
      .eq('motivo_ausencia', 'dia_tramite')
      .gte('fecha', yearStart)
      .lte('fecha', yearEnd);

    if (saldoError) {
      console.error('[AprobacionesPage] error al cargar el saldo de días de trámite:', saldoError.message);
      saldoLoadFailed = true;
    } else {
      const saldoRows = computeSaldoDiasTramite(
        solicitanteIds.map((id) => ({ id, full_name: null, email: '' })),
        (diasTramiteRaw ?? []) as DiaTramiteRow[]
      );
      saldoByUser = new Map(saldoRows.map((row) => [row.employeeId, row]));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-secondary">{copy.aprobaciones.title}</h2>
        <p className="text-sm text-neutral mt-0.5">{copy.aprobaciones.subtitle}</p>
      </div>

      <Card padding="sm">
        {error ? (
          <p className="text-error text-sm py-4">{copy.errors.generic}</p>
        ) : (
          <AprobacionesTable
            items={items}
            saldoByUser={Object.fromEntries(saldoByUser)}
            saldoLoadFailed={saldoLoadFailed}
          />
        )}
      </Card>
    </div>
  );
}
