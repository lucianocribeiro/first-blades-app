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
import type { MotivoAusencia } from '@/lib/db-types';

// resolver_ausencia_request (0013) es SECURITY DEFINER y valida admin por
// dentro leyendo auth.uid(): necesita la sesión real del admin (JWT con
// sub = su user id) para que esa guarda resuelva algo distinto de NULL. Un
// cliente service_role (createAdminClient) no tiene "sub" en su JWT, así
// que la guarda interna abortaría siempre — por eso acá va createServerClient(),
// a diferencia de aprobaciones/actions.ts (documentos), que sí necesita
// bypassear RLS con el cliente admin porque ahí no hay RPC que eleve privilegios.
type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

// FB-F4-16: contrato return-based — { ok:true, emailSent } | { ok:false, error }.
// En un build de producción, Next.js redacta el mensaje de CUALQUIER error
// que cruce el límite de una Server Action (`throw new Error(mensajeAmigable)`
// llegaba al cliente como "An error occurred in the Server Components
// render...", nunca el texto en español) — encontrado y confirmado contra CI
// real en FB-F4-14 §8 para aprobadas/actions.ts; mismo patrón, mismo bug acá.
// Un valor de retorno normal no pasa por esa redacción.
export type ResolveAusenciaResult =
  | { ok: true; emailSent: boolean }
  | { ok: false; error: string };

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
async function isPendiente(supabase: ServerSupabase, requestId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ausencia_requests')
    .select('estado')
    .eq('id', requestId)
    .single();

  if (error || !data) return false;
  return (data as { estado: string }).estado === 'pendiente';
}

// Vuelve a leer la solicitud + el perfil del dueño DESPUÉS de resolverla, para
// no confiar en datos que el cliente pudo haber tenido desactualizados o
// manipulados — mismo criterio que rejectDocument en aprobaciones/actions.ts.
//
// FB-F4-06: re-lee fecha_fin + motivo_ausencia + motivo_otros_texto además de
// fecha_inicio — el mail de resolución generalizado (cualquier motivo, no
// solo día de trámite) los necesita para armar el rango y el motivo amigable.
async function fetchRequestForNotification(supabase: ServerSupabase, requestId: string) {
  const { data, error } = await supabase
    .from('ausencia_requests')
    .select(
      'fecha_inicio, fecha_fin, motivo_ausencia, motivo_otros_texto, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)'
    )
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw error ?? new Error('No se encontró la solicitud de ausencia para notificar.');
  }

  return data as unknown as {
    fecha_inicio: string;
    fecha_fin: string;
    motivo_ausencia: MotivoAusencia;
    motivo_otros_texto: string | null;
    user_profile: { full_name: string | null; email: string | null } | null;
  };
}

export async function approveAusencia(requestId: string): Promise<ResolveAusenciaResult> {
  await requireAdmin();
  const supabase = await createServerClient();

  if (!(await isPendiente(supabase, requestId))) {
    return { ok: false, error: copy.aprobaciones.messages.alreadyResolved };
  }

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
      return { ok: false, error: friendly };
    }
    console.error('[approveAusencia] error al invocar resolver_ausencia_request:', error.message);
    return { ok: false, error: copy.errors.generic };
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
        to:                owner.email,
        fullName:          owner.full_name,
        fechaInicio:       req.fecha_inicio,
        fechaFin:          req.fecha_fin,
        motivoAusencia:    req.motivo_ausencia,
        motivoOtrosTexto:  req.motivo_otros_texto,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar aprobación de ausencia:', emailErr);
  }

  return { ok: true, emailSent };
}

export async function rejectAusencia(requestId: string, motivo: string): Promise<ResolveAusenciaResult> {
  const trimmed = motivo.trim();
  if (!trimmed) return { ok: false, error: copy.aprobaciones.rejectModal.motivoRequired };

  await requireAdmin();
  const supabase = await createServerClient();

  if (!(await isPendiente(supabase, requestId))) {
    return { ok: false, error: copy.aprobaciones.messages.alreadyResolved };
  }

  const { error } = await supabase.rpc('resolver_ausencia_request', {
    p_request_id:     requestId,
    p_accion:         'rechazar',
    p_motivo_rechazo: trimmed,
  } as never);

  if (error) {
    const friendly = translateResolverAusenciaError(error);
    if (friendly) {
      revalidatePath('/aprobaciones');
      return { ok: false, error: friendly };
    }
    console.error('[rejectAusencia] error al invocar resolver_ausencia_request:', error.message);
    return { ok: false, error: copy.errors.generic };
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
        to:                owner.email,
        fullName:          owner.full_name,
        fechaInicio:       req.fecha_inicio,
        fechaFin:          req.fecha_fin,
        motivoAusencia:    req.motivo_ausencia,
        motivoOtrosTexto:  req.motivo_otros_texto,
        motivoRechazo:     trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar rechazo de ausencia:', emailErr);
  }

  return { ok: true, emailSent };
}
