'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { AusenciaRequestInsert } from '@/lib/db-types';
import {
  buildAusenciaInsertPayload,
  translateAusenciaInsertError,
  validateAusenciaRequestInput,
  type CreateAusenciaInput,
} from './logic';

// FB-F4-16: contrato return-based en vez de throw — Next.js redacta el
// mensaje de cualquier error que cruce el límite de una Server Action en un
// build de producción (confirmado contra CI real en FB-F4-14 §8 para
// aprobadas/actions.ts). Un valor de retorno normal no pasa por esa
// redacción, así que el copy amigable (validación, solapamiento 23P01)
// viaja acá en vez de en una excepción.
export type CreateAusenciaResult = { ok: true } | { ok: false; error: string };

export async function createAusenciaRequest(input: CreateAusenciaInput): Promise<CreateAusenciaResult> {
  const profile = await requireAuth();

  // Autoridad server-side: el cliente puede pre-validar para UX, pero acá se
  // re-valida todo (motivo, rango, no-retroactiva, motivo_otros_texto) antes
  // de tocar la base — nunca se confía en que el formulario ya filtró.
  // No-retroactiva aplica igual para admin — sin excepción.
  const result = validateAusenciaRequestInput({
    motivo:           input.motivo,
    fechaInicio:      input.fechaInicio?.trim() ?? '',
    fechaFin:         input.fechaFin?.trim() ?? '',
    motivoOtrosTexto: input.motivoOtrosTexto,
  });
  if (!result.valid) return { ok: false, error: result.error };

  const supabase = await createServerClient();

  if (profile.role === 'admin') {
    // FB-ADJ-02: crear+aprobar en UNA sola RPC transaccional (fix del
    // Hallazgo Alto de FB-ADJ-AUD-01) — reemplaza la secuencia previa de
    // FB-ADJ-01 (insert(pendiente) → resolver(aprobar) → cleanup si fallaba),
    // que dejaba una ventana real de solicitud huérfana ante un crash o
    // fallo del propio cleanup entre los dos round-trips. Acá es un solo
    // statement: si algo falla adentro (guarda de admin, exclusion
    // constraint de no-solapamiento, colisión de calendario, audit_log), la
    // transacción entera revierte — no queda ni la solicitud, ni el
    // calendario, ni el audit. Ver migración 0019.
    const { error } = await supabase.rpc('crear_aprobar_ausencia_admin', {
      p_motivo:             input.motivo,
      p_fecha_inicio:       input.fechaInicio,
      p_fecha_fin:          input.fechaFin,
      p_motivo_otros_texto: input.motivo === 'otros' ? (input.motivoOtrosTexto?.trim() || null) : null,
      p_nota:               input.nota?.trim() || null,
    } as never);

    if (error) {
      const friendly = translateAusenciaInsertError(error);
      if (friendly) return { ok: false, error: friendly };
      console.error('[createAusenciaRequest] error al crear+aprobar (admin):', error.message);
      return { ok: false, error: copy.errors.generic };
    }

    revalidatePath('/solicitud-ausencia');
    revalidatePath('/aprobaciones');
    revalidatePath('/calendario');
    return { ok: true };
  }

  const insertData: AusenciaRequestInsert[] = [buildAusenciaInsertPayload(profile.id, input)];

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .insert() (mismo bug documentado en
  // calendario/actions.ts::upsertRotationAssignment). insertData ya está
  // tipado como AusenciaRequestInsert[] arriba; el cast acá es seguro.
  const { error } = await supabase.from('ausencia_requests').insert(insertData as never[]);

  if (error) {
    const friendly = translateAusenciaInsertError(error);
    if (friendly) return { ok: false, error: friendly };
    console.error('[createAusenciaRequest] error al insertar:', error.message);
    return { ok: false, error: copy.errors.generic };
  }

  revalidatePath('/solicitud-ausencia');
  return { ok: true };
}
