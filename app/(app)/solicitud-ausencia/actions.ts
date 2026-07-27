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

export async function createAusenciaRequest(input: CreateAusenciaInput): Promise<void> {
  const profile = await requireAuth();

  // El formulario no se muestra a admin (modo consulta); doble chequeo en servidor.
  if (profile.role === 'admin') throw new Error(copy.errors.unauthorized);

  // Autoridad server-side: el cliente puede pre-validar para UX, pero acá se
  // re-valida todo (motivo, rango, no-retroactiva, motivo_otros_texto) antes
  // de tocar la base — nunca se confía en que el formulario ya filtró.
  const result = validateAusenciaRequestInput({
    motivo:           input.motivo,
    fechaInicio:      input.fechaInicio?.trim() ?? '',
    fechaFin:         input.fechaFin?.trim() ?? '',
    motivoOtrosTexto: input.motivoOtrosTexto,
  });
  if (!result.valid) throw new Error(result.error);

  const supabase = await createServerClient();
  const insertData: AusenciaRequestInsert[] = [buildAusenciaInsertPayload(profile.id, input)];

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .insert() (mismo bug documentado en
  // calendario/actions.ts::upsertRotationAssignment). insertData ya está
  // tipado como AusenciaRequestInsert[] arriba; el cast acá es seguro.
  const { error } = await supabase.from('ausencia_requests').insert(insertData as never[]);

  if (error) {
    const friendly = translateAusenciaInsertError(error);
    if (friendly) throw new Error(friendly);
    console.error('[createAusenciaRequest] error al insertar:', error.message);
    throw new Error(copy.errors.generic);
  }

  revalidatePath('/solicitud-ausencia');
}
