'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { PasajeRequestInsert } from '@/lib/db-types';
import {
  buildPasajeInsertPayload,
  validatePasajeRequestInput,
  type CreatePasajeInput,
} from './logic';

// empleadoId solo lo manda el formulario cuando el rol es supervisor (el
// selector de equipo); para empleado no se muestra el campo y no se envía.
export type CreatePasajeFormInput = CreatePasajeInput & { empleadoId?: string };

// FB-F4-16: contrato return-based en vez de throw — mismo motivo que
// solicitud-ausencia/actions.ts::createAusenciaRequest (Next.js redacta el
// mensaje de cualquier error que cruce el límite de una Server Action en un
// build de producción, confirmado contra CI real en FB-F4-14 §8).
export type CreatePasajeResult = { ok: true } | { ok: false; error: string };

export async function createPasajeRequest(input: CreatePasajeFormInput): Promise<CreatePasajeResult> {
  const profile = await requireAuth();

  const supabase = await createServerClient();

  // Resolución de empleado_id server-side — nunca se confía ciegamente en el
  // input del cliente: un empleado SIEMPRE pide para sí mismo (cualquier
  // empleadoId que mande el cliente se ignora acá, no puede spoofear a otro
  // compañero); un supervisor puede pedir para sí o para un integrante de su
  // equipo (profiles.supervisor_id = auth.uid()). La RLS ya limita el INSERT
  // a ese mismo scope, pero esta revalidación server-side da un error
  // amigable ANTES de tocar la base, en vez de propagar el rechazo crudo de
  // Postgres — defensa en profundidad, mismo criterio que el pre-check de
  // scope en aprobaciones/ausencia-actions.ts.
  //
  // FB-ADJ-01: admin se resuelve igual que empleado — SIEMPRE para sí mismo,
  // "admin-para-sí solamente" (no hay selector de equipo para admin en el
  // form; cualquier empleadoId que mande el cliente se ignora acá).
  let empleadoId: string;
  if (profile.role === 'empleado' || profile.role === 'admin') {
    empleadoId = profile.id;
  } else {
    const candidateId = input.empleadoId?.trim();
    if (!candidateId) return { ok: false, error: copy.solicitudPasaje.errors.empleadoRequerido };

    if (candidateId !== profile.id) {
      const { data: member, error: memberError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', candidateId)
        .eq('supervisor_id', profile.id)
        .maybeSingle();

      if (memberError) {
        console.error('[createPasajeRequest] error al validar el equipo:', memberError.message);
        return { ok: false, error: copy.errors.generic };
      }
      if (!member) return { ok: false, error: copy.solicitudPasaje.errors.empleadoFueraDeEquipo };
    }
    empleadoId = candidateId;
  }

  // Autoridad server-side: el cliente puede pre-validar para UX, pero acá se
  // re-valida todo (motivo, origen, destino, días, no-retroactiva) antes de
  // tocar la base — nunca se confía en que el formulario ya filtró.
  const result = validatePasajeRequestInput({
    motivoViaje: input.motivoViaje,
    origen:      input.origen,
    destino:     input.destino,
    diasViaje:   input.diasViaje,
  });
  if (!result.valid) return { ok: false, error: result.error };

  const insertData: PasajeRequestInsert[] = [
    buildPasajeInsertPayload(profile.id, empleadoId, input),
  ];

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .insert() (mismo bug documentado en
  // solicitud-ausencia/actions.ts::createAusenciaRequest). insertData ya está
  // tipado como PasajeRequestInsert[] arriba; el cast acá es seguro.
  // .select('id').single() trae el id insertado — solo hace falta para el
  // camino de admin (auto-aprobación de abajo), pero pedirlo siempre evita
  // duplicar el bloque de INSERT.
  const { data: inserted, error } = await supabase
    .from('pasaje_requests')
    .insert(insertData as never[])
    .select('id')
    .single();

  if (error || !inserted) {
    console.error('[createPasajeRequest] error al insertar:', error?.message);
    return { ok: false, error: copy.errors.generic };
  }

  if (profile.role !== 'admin') {
    revalidatePath('/solicitud-pasaje');
    return { ok: true };
  }

  // FB-ADJ-01: admin envía para sí → auto-aprobación (única excepción al
  // purgatorio, ver constitución §4). Mismo patrón que
  // solicitud-ausencia/actions.ts::createAusenciaRequest — la solicitud ya
  // quedó creada como pendiente arriba (policy pasajes_insert_admin); acá se
  // invoca la RPC de resolución con la sesión real del admin. Si falla, se
  // borra la fila recién creada (policy pasajes_delete_admin) para no dejar
  // un pendiente huérfano fuera de Aprobaciones.
  const requestId = (inserted as { id: string }).id;
  const { error: resolveError } = await supabase.rpc('resolver_pasaje_request', {
    p_request_id: requestId,
    p_accion:     'aprobar',
  } as never);

  if (resolveError) {
    console.error('[createPasajeRequest] error al auto-aprobar (admin):', resolveError.message);
    const { error: cleanupError } = await supabase.from('pasaje_requests').delete().eq('id', requestId);
    if (cleanupError) {
      console.error('[createPasajeRequest] error al limpiar la solicitud huérfana:', cleanupError.message);
    }
    return { ok: false, error: copy.errors.generic };
  }

  revalidatePath('/solicitud-pasaje');
  revalidatePath('/aprobaciones');
  revalidatePath('/calendario');
  return { ok: true };
}
