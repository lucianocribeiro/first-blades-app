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
import type { AusenciaRequest, Document, EstadoDia, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type RawDocument = Document & { user_profile?: UserProfilePick | null };
type RawAusencia = AusenciaRequest & { user_profile?: UserProfilePick | null };

// FB-F4-05: previsualización de sobrescritura — días del rango de la
// solicitud que ya tienen fila en rotation_assignments.
export type OverwriteDay = { fecha: string; estado_dia: EstadoDia; es_estimado: boolean };

// FB-F4-06: estado por request de la previsualización. "no hay días a
// sobrescribir" (ok, days=[]) y "no se pudo calcular" (error) son casos
// distintos — antes ambos colapsaban a "sin aviso" cuando la query fallaba.
export type OverwriteStatus = { status: 'ok'; days: OverwriteDay[] } | { status: 'error' };

export default async function AprobacionesPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  // Bandeja única: documentos pendientes + ausencias pendientes de
  // CUALQUIER motivo (FB-F4-05 — antes acotada a día de trámite), cada uno
  // con join a profiles para mostrar el nombre del solicitante.
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
      .order('created_at', { ascending: true }),
  ]);

  const error = docsResult.error || ausenciasResult.error;

  const documents = ((docsResult.data as RawDocument[] | null) ?? []).map(
    (doc): PendingItem => ({ kind: 'documento', data: doc })
  );
  const ausenciasRaw = (ausenciasResult.data as RawAusencia[] | null) ?? [];
  const ausencias = ausenciasRaw.map((req): PendingItem => ({ kind: 'ausencia', data: req }));

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

  // FB-F4-05: previsualización de sobrescritura, no bloqueante — para cada
  // ausencia pendiente, qué días de su rango ya tienen fila en
  // rotation_assignments (incluidos es_estimado=true). Es informativa: la
  // escritura real y el registro de old_data los hace la RPC atómica al
  // aprobar (resolver_ausencia_request), esto solo ayuda al admin a decidir
  // con el estado actual a la vista. Una consulta por ítem (no una sola
  // consulta agregada): el rango difiere por solicitud, y el tamaño esperado
  // de la cola no justifica una query más compleja.
  //
  // FB-F4-06: un fallo de query ya NO se trata como "sin días a
  // sobrescribir" (dato válido) — eso ocultaba la falla al admin. Cada
  // request queda con status 'ok' (con sus días, aunque sea []) o 'error',
  // y la UI distingue ambos casos. Best-effort igual: un fallo puntual solo
  // afecta el aviso de ESA solicitud (se loguea), no rompe la cola ni
  // bloquea aprobar/rechazar.
  const overwriteStatusByRequest = new Map<string, OverwriteStatus>();
  await Promise.all(
    ausenciasRaw.map(async (req) => {
      const { data, error: overwriteError } = await supabase
        .from('rotation_assignments')
        .select('fecha, estado_dia, es_estimado')
        .eq('user_id', req.user_id)
        .gte('fecha', req.fecha_inicio)
        .lte('fecha', req.fecha_fin);

      if (overwriteError) {
        console.error(
          `[AprobacionesPage] error al previsualizar sobrescritura de ${req.id}:`,
          overwriteError.message
        );
        overwriteStatusByRequest.set(req.id, { status: 'error' });
        return;
      }
      overwriteStatusByRequest.set(req.id, { status: 'ok', days: (data ?? []) as OverwriteDay[] });
    })
  );

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
            overwriteStatusByRequest={Object.fromEntries(overwriteStatusByRequest)}
          />
        )}
      </Card>
    </div>
  );
}
