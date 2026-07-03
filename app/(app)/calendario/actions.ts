'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { EstadoDia, MotivoAusencia, RotationAssignmentInsert } from '@/lib/db-types';
import { validateAssignmentInput } from './utils';

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
