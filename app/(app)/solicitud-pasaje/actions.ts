'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { PasajeRequestInsert } from '@/lib/db-types';
import { sortDiasViaje } from '@/lib/rotation/pasaje-display';
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

  if (profile.role === 'admin') {
    // Autoridad server-side — no-retroactiva sigue aplicando al admin, ANTES
    // de invocar la RPC (misma regla que no-admin, sin excepción).
    const result = validatePasajeRequestInput({
      motivoViaje: input.motivoViaje,
      origen:      input.origen,
      destino:     input.destino,
      diasViaje:   input.diasViaje,
    });
    if (!result.valid) return { ok: false, error: result.error };

    // dias_viaje ordenado y dedupeado antes de mandarlo a la RPC — mismo
    // criterio que buildPasajeInsertPayload (camino no-admin) para no
    // persistir fechas duplicadas ni depender del orden del cliente.
    const diasOrdenados = sortDiasViaje([...new Set(input.diasViaje)]);

    // FB-ADJ-02: crear+aprobar en UNA sola RPC transaccional (fix del
    // Hallazgo Alto de FB-ADJ-AUD-01) — reemplaza la secuencia previa de
    // FB-ADJ-01 (insert(pendiente) → resolver(aprobar) → cleanup si fallaba,
    // ventana real de solicitud huérfana). Ver
    // solicitud-ausencia/actions.ts::createAusenciaRequest y migración 0019
    // para el detalle de por qué es atómica de verdad. Admin siempre para
    // sí — esta RPC no acepta "para quién" (sin selector de equipo).
    const { error } = await supabase.rpc('crear_aprobar_pasaje_admin', {
      p_motivo_viaje: input.motivoViaje,
      p_origen:       input.origen.trim(),
      p_destino:      input.destino.trim(),
      p_dias_viaje:   diasOrdenados,
      p_nota:         input.nota?.trim() || null,
    } as never);

    if (error) {
      console.error('[createPasajeRequest] error al crear+aprobar (admin):', error.message);
      return { ok: false, error: copy.errors.generic };
    }

    revalidatePath('/solicitud-pasaje');
    revalidatePath('/aprobaciones');
    revalidatePath('/calendario');
    return { ok: true };
  }

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
  const { error } = await supabase.from('pasaje_requests').insert(insertData as never[]);

  if (error) {
    console.error('[createPasajeRequest] error al insertar:', error.message);
    return { ok: false, error: copy.errors.generic };
  }

  revalidatePath('/solicitud-pasaje');
  return { ok: true };
}
