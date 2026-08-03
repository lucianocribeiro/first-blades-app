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
  const insertData: AusenciaRequestInsert[] = [buildAusenciaInsertPayload(profile.id, input)];

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .insert() (mismo bug documentado en
  // calendario/actions.ts::upsertRotationAssignment). insertData ya está
  // tipado como AusenciaRequestInsert[] arriba; el cast acá es seguro.
  // .select('id').single() trae el id insertado — solo hace falta para el
  // camino de admin (auto-aprobación de abajo), pero pedirlo siempre evita
  // duplicar el bloque de INSERT.
  const { data: inserted, error } = await supabase
    .from('ausencia_requests')
    .insert(insertData as never[])
    .select('id')
    .single();

  if (error || !inserted) {
    const friendly = translateAusenciaInsertError(error);
    if (friendly) return { ok: false, error: friendly };
    console.error('[createAusenciaRequest] error al insertar:', error?.message);
    return { ok: false, error: copy.errors.generic };
  }

  if (profile.role !== 'admin') {
    revalidatePath('/solicitud-ausencia');
    return { ok: true };
  }

  // FB-ADJ-01: admin envía para sí → auto-aprobación (única excepción al
  // purgatorio, ver constitución §4 y "nada se autoactiva"). La solicitud ya
  // quedó creada como pendiente arriba (misma policy ausencias_insert_admin);
  // acá se invoca la misma RPC de resolución que usa Aprobaciones, con la
  // sesión real del admin (createServerClient(), no service_role — su guarda
  // interna is_admin()/auth.uid() necesita el JWT real). Si la resolución
  // falla, se borra la fila recién creada (policy ausencias_delete_admin)
  // para no dejar un pendiente huérfano fuera de la bandeja de Aprobaciones.
  const requestId = (inserted as { id: string }).id;
  const { error: resolveError } = await supabase.rpc('resolver_ausencia_request', {
    p_request_id: requestId,
    p_accion:     'aprobar',
  } as never);

  if (resolveError) {
    console.error('[createAusenciaRequest] error al auto-aprobar (admin):', resolveError.message);
    const { error: cleanupError } = await supabase.from('ausencia_requests').delete().eq('id', requestId);
    if (cleanupError) {
      console.error('[createAusenciaRequest] error al limpiar la solicitud huérfana:', cleanupError.message);
    }
    return { ok: false, error: copy.errors.generic };
  }

  revalidatePath('/solicitud-ausencia');
  revalidatePath('/aprobaciones');
  revalidatePath('/calendario');
  return { ok: true };
}
