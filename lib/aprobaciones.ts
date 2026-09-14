import type { createServerClient } from '@/lib/supabase/server';

// FB-PI-01: fuente única de verdad de "qué es un pendiente de la bandeja de
// Aprobaciones". La bandeja (app/(app)/aprobaciones/page.tsx) arma sus filas
// con pendientesQuery() y el badge de la campanita cuenta con
// contarAprobacionesPendientes(), que usa esa MISMA función — si el filtro
// cambia acá, cambian las dos a la vez y el número no se desincroniza de las
// filas visibles.
//
// Scope vigente: SOLO estado = 'pendiente', en las tres tablas, sin filtro de
// negocio adicional. Ausencias de cualquier motivo desde FB-F4-05 (antes la
// cola se acotaba a motivo_ausencia = 'dia_tramite'; la nota de constitución
// §5 que habla de "motivo + estado" es de Fase 3 — ver
// docs/audits/FB-PI-01-INSPECT.md §1.1). Si alguna vez se vuelve a acotar la
// bandeja, el filtro va acá y no en la página.
//
// Cliente: siempre la sesión del admin (createServerClient), nunca
// createAdminClient — la lectura pasa por RLS (constitución §6.1).

export const TABLAS_APROBACION = ['documents', 'ausencia_requests', 'pasaje_requests'] as const;
export type TablaAprobacion = (typeof TABLAS_APROBACION)[number];

// Tipo del cliente de createServerClient() (@supabase/ssr), no
// SupabaseClient<Database> a secas: los genéricos de @supabase/ssr no son
// asignables a los de supabase-js (mismo criterio que ServerSupabase en
// aprobaciones/ausencia-actions.ts).
type Supabase = Awaited<ReturnType<typeof createServerClient>>;

export function pendientesQuery(
  supabase: Supabase,
  tabla: TablaAprobacion,
  columns: string,
  options?: { count: 'exact'; head: true }
) {
  return supabase.from(tabla).select(columns, options).eq('estado', 'pendiente');
}

// Devuelve el total de pendientes de la bandeja, o null si alguna lectura
// falló. Los errores de PostgREST llegan como valor (constitución §2.5), no
// como excepción: se leen uno por uno. Un fallo NO devuelve una suma parcial
// (sería un número falso sobre la campanita): se loguea y se devuelve null,
// y quien llama decide degradar a "sin badge" sin romper el render.
export async function contarAprobacionesPendientes(supabase: Supabase): Promise<number | null> {
  const resultados = await Promise.all(
    TABLAS_APROBACION.map((tabla) =>
      pendientesQuery(supabase, tabla, '*', { count: 'exact', head: true })
    )
  );

  let total = 0;
  for (const [i, { count, error }] of resultados.entries()) {
    if (error || count === null) {
      console.error(
        `[contarAprobacionesPendientes] error al contar pendientes de ${TABLAS_APROBACION[i]}:`,
        error?.message ?? 'count vacío'
      );
      return null;
    }
    total += count;
  }
  return total;
}
