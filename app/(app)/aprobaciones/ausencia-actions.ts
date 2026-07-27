'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import {
  sendAusenciaApprovalEmail,
  sendAusenciaRejectionEmail,
} from '@/lib/email/ausencia-resolution-email';
import { translateResolverAusenciaError } from './ausencia-logic';

// resolver_ausencia_request (0013) es SECURITY DEFINER y valida admin por
// dentro leyendo auth.uid(): necesita la sesión real del admin (JWT con
// sub = su user id) para que esa guarda resuelva algo distinto de NULL. Un
// cliente service_role (createAdminClient) no tiene "sub" en su JWT, así
// que la guarda interna abortaría siempre — por eso acá va createServerClient(),
// a diferencia de aprobaciones/actions.ts (documentos), que sí necesita
// bypassear RLS con el cliente admin porque ahí no hay RPC que eleve privilegios.
type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

export type ResolveAusenciaResult = { emailSent: boolean };

// Re-lee la solicitud ANTES de invocar la RPC: la RPC valida admin + estado
// pendiente por dentro, pero esta re-lectura server-side es la que da un
// error amigable de "ya fue resuelta" sin depender del texto crudo de
// Postgres, y evita invocar la RPC (y el mail) para un requestId ya resuelto
// o inexistente. Capa de app superpuesta a la RPC — no la reemplaza, la RPC
// sigue siendo la autoridad de admin/estado/atomicidad.
//
// FB-F4-05: hasta acá esta bandeja también revalidaba motivo_ausencia ===
// 'dia_tramite' (scope acotado a un solo motivo, Fase 3). La bandeja de
// Aprobaciones ahora resuelve ausencias de cualquier motivo, así que ese
// chequeo se retira — el único scope que queda es "pendiente". La RLS y la
// guarda de la RPC nunca limitaron el motivo por diseño; ese límite siempre
// vivió acá, y ahora el límite correcto es "cualquier ausencia pendiente".
async function assertPendiente(supabase: ServerSupabase, requestId: string): Promise<void> {
  const { data, error } = await supabase
    .from('ausencia_requests')
    .select('estado')
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw new Error(copy.aprobaciones.messages.alreadyResolved);
  }
  const row = data as { estado: string };
  if (row.estado !== 'pendiente') {
    throw new Error(copy.aprobaciones.messages.alreadyResolved);
  }
}

// Vuelve a leer la solicitud + el perfil del dueño DESPUÉS de resolverla, para
// no confiar en datos que el cliente pudo haber tenido desactualizados o
// manipulados — mismo criterio que rejectDocument en aprobaciones/actions.ts.
async function fetchRequestForNotification(supabase: ServerSupabase, requestId: string) {
  const { data, error } = await supabase
    .from('ausencia_requests')
    .select('fecha_inicio, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)')
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw error ?? new Error('No se encontró la solicitud de ausencia para notificar.');
  }

  return data as unknown as {
    fecha_inicio: string;
    user_profile: { full_name: string | null; email: string | null } | null;
  };
}

export async function approveAusencia(requestId: string): Promise<ResolveAusenciaResult> {
  await requireAdmin();
  const supabase = await createServerClient();

  await assertPendiente(supabase, requestId);

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never`/`undefined` en .rpc() (mismo bug ya documentado
  // para .insert()/.upsert() en solicitud-ausencia/actions.ts y
  // calendario/actions.ts). El args object ya está tipado por la firma real
  // de la función (supabase/types.ts); el cast acá es seguro.
  const { error } = await supabase.rpc('resolver_ausencia_request', {
    p_request_id: requestId,
    p_accion:     'aprobar',
  } as never);

  if (error) {
    const friendly = translateResolverAusenciaError(error);
    if (friendly) {
      revalidatePath('/aprobaciones');
      throw new Error(friendly);
    }
    console.error('[approveAusencia] error al invocar resolver_ausencia_request:', error.message);
    throw new Error(copy.errors.generic);
  }

  // La resolución ya está commiteada (fuente de verdad); todo lo que sigue
  // (mail) es best-effort y no puede revertirla.
  revalidatePath('/aprobaciones');
  revalidatePath('/solicitud-ausencia');
  revalidatePath('/calendario');

  let emailSent = false;
  try {
    const req = await fetchRequestForNotification(supabase, requestId);
    const owner = req.user_profile;
    if (!owner?.email) {
      console.warn(
        `[email] aprobación de ausencia ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendAusenciaApprovalEmail({
        to:          owner.email,
        fullName:    owner.full_name,
        fechaInicio: req.fecha_inicio,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar aprobación de ausencia:', emailErr);
  }

  return { emailSent };
}

export async function rejectAusencia(requestId: string, motivo: string): Promise<ResolveAusenciaResult> {
  const trimmed = motivo.trim();
  if (!trimmed) throw new Error(copy.aprobaciones.rejectModal.motivoRequired);

  await requireAdmin();
  const supabase = await createServerClient();

  await assertPendiente(supabase, requestId);

  const { error } = await supabase.rpc('resolver_ausencia_request', {
    p_request_id:     requestId,
    p_accion:         'rechazar',
    p_motivo_rechazo: trimmed,
  } as never);

  if (error) {
    const friendly = translateResolverAusenciaError(error);
    if (friendly) {
      revalidatePath('/aprobaciones');
      throw new Error(friendly);
    }
    console.error('[rejectAusencia] error al invocar resolver_ausencia_request:', error.message);
    throw new Error(copy.errors.generic);
  }

  revalidatePath('/aprobaciones');
  revalidatePath('/solicitud-ausencia');

  let emailSent = false;
  try {
    const req = await fetchRequestForNotification(supabase, requestId);
    const owner = req.user_profile;
    if (!owner?.email) {
      console.warn(
        `[email] rechazo de ausencia ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendAusenciaRejectionEmail({
        to:          owner.email,
        fullName:    owner.full_name,
        fechaInicio: req.fecha_inicio,
        motivo:      trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar rechazo de ausencia:', emailErr);
  }

  return { emailSent };
}
