// Cron de promoción estimado → real (FB-F3-07, PRD Fase 3: "un estimado
// pasa a real automáticamente 1 semana antes de la fecha").
import { createAdminClient } from '@/lib/supabase/admin';
import { getBusinessToday } from '@/lib/business-date';

export { getBusinessToday };

export const PROMOTION_WINDOW_DAYS = 7;

// Fecha límite de la ventana de promoción: hoy + 7 días. Cálculo en UTC
// sobre el string YYYY-MM-DD (fecha calendario pura, sin componente
// horario) — mismo patrón que
// app/(app)/calendario/utils.ts::computeDefaultEsEstimado.
export function getPromotionCutoff(today: string = getBusinessToday()): string {
  const [y, m, d] = today.split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d + PROMOTION_WINDOW_DAYS));
  return cutoff.toISOString().split('T')[0];
}

export type PromoteResult = { promoted: number };

/**
 * Promueve a real (es_estimado = false) los días estimados cuya fecha ya
 * entró en la ventana de 7 días. UPDATE acotado y explícito
 * (es_estimado = true AND fecha <= cutoff) — nunca un UPDATE sin ese
 * doble filtro. Idempotente: correrlo de nuevo no toca las filas ya en
 * es_estimado = false. `.select('id')` trae las filas afectadas para
 * loguear la cantidad real promovida.
 *
 * @param client Cliente Supabase inyectable (default = admin de prod,
 *               service_role — es job de sistema, bypasea RLS por diseño;
 *               el scope real vive en el WHERE explícito de abajo).
 */
export async function promoteEstimatedDays(
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  today: string = getBusinessToday()
): Promise<PromoteResult> {
  const cutoff = getPromotionCutoff(today);

  const { data, error } = await client
    .from('rotation_assignments')
    .update({ es_estimado: false })
    .eq('es_estimado', true)
    .lte('fecha', cutoff)
    .select('id');

  if (error) throw new Error(error.message);

  return { promoted: data?.length ?? 0 };
}
