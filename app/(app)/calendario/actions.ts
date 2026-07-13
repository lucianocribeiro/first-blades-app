'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { getBusinessToday } from '@/lib/rotation/promote-estimated';
import type { EstadoDia, MotivoAusencia, RotationAssignmentInsert } from '@/lib/db-types';
import { validateAssignmentInput, describeRangeUpsertError } from './utils';

export type UpsertRotationInput = {
  user_id: string;
  fecha: string;
  estado_dia: EstadoDia;
  es_estimado: boolean;
  motivo_ausencia?: MotivoAusencia | null;
  motivo_otros_texto?: string | null;
};

export async function upsertRotationAssignment(input: UpsertRotationInput): Promise<void> {
  await requireAdmin();

  const result = validateAssignmentInput(input);
  if (!result.valid) throw new Error(result.error);

  const motivoAusencia = input.estado_dia === 'periodo_fuera_trabajo' ? (input.motivo_ausencia ?? null) : null;
  const motivoOtrosTexto = motivoAusencia === 'otros' ? (input.motivo_otros_texto?.trim() || null) : null;

  const payload: RotationAssignmentInsert[] = [{
    user_id: input.user_id,
    fecha: input.fecha,
    estado_dia: input.estado_dia,
    es_estimado: input.es_estimado,
    motivo_ausencia: motivoAusencia,
    motivo_otros_texto: motivoOtrosTexto,
  }];

  // Sesión del admin (RLS aplicada): rotation_assignments ya tiene FOR ALL
  // para admin, no hace falta el service role.
  const supabase = await createServerClient();
  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .upsert()/.insert() (mismo bug ya documentado
  // para .in() en mi-perfil/actions.ts::getSignedUrls). payload ya está
  // tipado como RotationAssignmentInsert[] arriba; el cast acá es seguro.
  const { error } = await supabase
    .from('rotation_assignments')
    .upsert(payload as never[], { onConflict: 'user_id,fecha' });

  if (error) {
    console.error('[upsertRotationAssignment] error al guardar:', error.message);
    throw new Error(copy.calendario.messages.upsertError);
  }

  revalidatePath('/calendario');
}

export type UpsertRotationRangeInput = {
  user_id: string;
  fechas: string[];
  estado_dia: EstadoDia;
  motivo_ausencia?: MotivoAusencia | null;
  motivo_otros_texto?: string | null;
};

export type UpsertRotationRangeResult = {
  applied: string[];
  failed: { fecha: string; motivo: string }[];
};

// FB-F3-23: pintado por rango, una fila (un user_id), N días consecutivos,
// mismo estado/motivo para todos. Best-effort: un día que falla no aborta el
// resto — se reporta al admin con el motivo legible de cada falla, en vez de
// tragar el error o cortar la operación a mitad de camino (reintentar es
// seguro: el upsert de cada día es idempotente).
export async function upsertRotationRange(
  input: UpsertRotationRangeInput
): Promise<UpsertRotationRangeResult> {
  await requireAdmin();

  // dia_tramite tiene su propio flujo gobernado (cupo + aprobación vía
  // Solicitud de Ausencia → Aprobaciones → resolver_ausencia_request). Un
  // pintado masivo por rango lo saltearía, así que queda excluido acá
  // aunque de algún modo llegara al server action (el modal ya no lo ofrece).
  if (input.motivo_ausencia === 'dia_tramite') {
    throw new Error(copy.calendario.range.errors.diaTramiteNoDisponible);
  }

  const result = validateAssignmentInput({
    estado_dia: input.estado_dia,
    motivo_ausencia: input.motivo_ausencia,
    motivo_otros_texto: input.motivo_otros_texto,
  });
  if (!result.valid) throw new Error(result.error);

  const motivoAusencia = input.estado_dia === 'periodo_fuera_trabajo' ? (input.motivo_ausencia ?? null) : null;
  const motivoOtrosTexto = motivoAusencia === 'otros' ? (input.motivo_otros_texto?.trim() || null) : null;

  const supabase = await createServerClient();
  const today = getBusinessToday();

  const applied: string[] = [];
  const failed: { fecha: string; motivo: string }[] = [];

  for (const fecha of input.fechas) {
    const payload: RotationAssignmentInsert[] = [{
      user_id: input.user_id,
      fecha,
      estado_dia: input.estado_dia,
      es_estimado: fecha > today,
      motivo_ausencia: motivoAusencia,
      motivo_otros_texto: motivoOtrosTexto,
    }];

    const { error } = await supabase
      .from('rotation_assignments')
      .upsert(payload as never[], { onConflict: 'user_id,fecha' });

    if (error) {
      console.error(`[upsertRotationRange] error al guardar ${fecha}:`, error.message);
      failed.push({ fecha, motivo: describeRangeUpsertError(error.message) });
    } else {
      applied.push(fecha);
    }
  }

  if (applied.length > 0) {
    revalidatePath('/calendario');
  }

  return { applied, failed };
}
