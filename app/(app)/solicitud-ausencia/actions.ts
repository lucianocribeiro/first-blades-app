'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { AusenciaRequestInsert } from '@/lib/db-types';
import { buildAusenciaInsertPayload, translateAusenciaInsertError, type CreateDiaTramiteInput } from './logic';

export async function createDiaTramiteRequest(input: CreateDiaTramiteInput): Promise<void> {
  const profile = await requireAuth();

  // El formulario no se muestra a admin (modo consulta); doble chequeo en servidor.
  if (profile.role === 'admin') throw new Error(copy.errors.unauthorized);

  const fecha = input.fecha?.trim();
  if (!fecha) throw new Error(copy.solicitudAusencia.errors.fechaRequerida);

  const supabase = await createServerClient();
  const insertData: AusenciaRequestInsert[] = [buildAusenciaInsertPayload(profile.id, { fecha, nota: input.nota })];

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never` en .insert() (mismo bug documentado en
  // calendario/actions.ts::upsertRotationAssignment). insertData ya está
  // tipado como AusenciaRequestInsert[] arriba; el cast acá es seguro.
  const { error } = await supabase.from('ausencia_requests').insert(insertData as never[]);

  if (error) {
    const friendly = translateAusenciaInsertError(error);
    if (friendly) throw new Error(friendly);
    console.error('[createDiaTramiteRequest] error al insertar:', error.message);
    throw new Error(copy.errors.generic);
  }

  revalidatePath('/solicitud-ausencia');
}
