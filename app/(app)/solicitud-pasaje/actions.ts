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

export async function createPasajeRequest(input: CreatePasajeFormInput): Promise<void> {
  const profile = await requireAuth();

  // El formulario no se muestra a admin (modo consulta); doble chequeo en servidor.
  if (profile.role === 'admin') throw new Error(copy.errors.unauthorized);

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
  let empleadoId: string;
  if (profile.role === 'empleado') {
    empleadoId = profile.id;
  } else {
    const candidateId = input.empleadoId?.trim();
    if (!candidateId) throw new Error(copy.solicitudPasaje.errors.empleadoRequerido);

    if (candidateId !== profile.id) {
      const { data: member, error: memberError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', candidateId)
        .eq('supervisor_id', profile.id)
        .maybeSingle();

      if (memberError) {
        console.error('[createPasajeRequest] error al validar el equipo:', memberError.message);
        throw new Error(copy.errors.generic);
      }
      if (!member) throw new Error(copy.solicitudPasaje.errors.empleadoFueraDeEquipo);
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
  if (!result.valid) throw new Error(result.error);

  const insertData: PasajeRequestInsert[] = [
    buildPasajeInsertPayload(profile.id, empleadoId, input),
  ];

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .insert() (mismo bug documentado en
  // solicitud-ausencia/actions.ts::createAusenciaRequest). insertData ya está
  // tipado como PasajeRequestInsert[] arriba; el cast acá es seguro.
  const { error } = await supabase.from('pasaje_requests').insert(insertData as never[]);

  if (error) {
    console.error('[createPasajeRequest] error al insertar:', error.message);
    throw new Error(copy.errors.generic);
  }

  revalidatePath('/solicitud-pasaje');
}
