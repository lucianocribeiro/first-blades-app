'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import {
  sendPasajeApprovalEmail,
  sendPasajeRejectionEmail,
} from '@/lib/email/pasaje-resolution-email';
// translateResolverAusenciaError no es ausencia-específica en su lógica: solo
// matchea el texto "ya fue resuelta" del SQLSTATE 22023, que
// resolver_pasaje_request lanza con el mismo mensaje que resolver_ausencia_request
// (mismo molde de guardas, ver 0016). Se reusa tal cual en vez de duplicar el
// mismo regex/copy en un archivo pasaje-logic.ts.
import { translateResolverAusenciaError } from './ausencia-logic';
import type { MotivoViaje } from '@/lib/db-types';

// resolver_pasaje_request (0016) es SECURITY DEFINER y valida admin por
// dentro leyendo auth.uid(): necesita la sesión real del admin
// (createServerClient()), no un cliente service_role — mismo razonamiento
// que ausencia-actions.ts.
type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

// FB-F4-16: mismo fix que ausencia-actions.ts — contrato return-based en vez
// de throw, porque Next.js redacta el mensaje de cualquier error que cruce
// el límite de una Server Action en un build de producción (confirmado
// contra CI real en FB-F4-14 §8).
export type ResolvePasajeResult =
  | { ok: true; emailSent: boolean }
  | { ok: false; error: string };

// Re-lee la solicitud ANTES de invocar la RPC — mismo criterio que
// isPendiente en ausencia-actions.ts: da un error amigable de "ya fue
// resuelta" sin depender del texto crudo de Postgres, y evita invocar la RPC
// (y el mail) para un requestId ya resuelto o inexistente.
async function isPendiente(supabase: ServerSupabase, requestId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('pasaje_requests')
    .select('estado')
    .eq('id', requestId)
    .single();

  if (error || !data) return false;
  return (data as { estado: string }).estado === 'pendiente';
}

// Vuelve a leer la solicitud + el perfil del EMPLEADO (quien viaja, no
// necesariamente quien solicitó — un supervisor puede pedir para su equipo)
// DESPUÉS de resolverla, para no confiar en datos que el cliente pudo tener
// desactualizados — mismo criterio que fetchRequestForNotification en
// ausencia-actions.ts. El mail avisa a quien viaja, que es a quien le cambia
// el calendario.
async function fetchRequestForNotification(supabase: ServerSupabase, requestId: string) {
  const { data, error } = await supabase
    .from('pasaje_requests')
    .select(
      'motivo_viaje, origen, destino, dias_viaje, empleado_profile:profiles!pasaje_requests_empleado_id_fkey(full_name, email)'
    )
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw error ?? new Error('No se encontró la solicitud de pasaje para notificar.');
  }

  return data as unknown as {
    motivo_viaje: MotivoViaje;
    origen: string;
    destino: string;
    dias_viaje: string[] | null;
    empleado_profile: { full_name: string | null; email: string | null } | null;
  };
}

export async function approvePasaje(requestId: string): Promise<ResolvePasajeResult> {
  await requireAdmin();
  const supabase = await createServerClient();

  if (!(await isPendiente(supabase, requestId))) {
    return { ok: false, error: copy.aprobaciones.messages.alreadyResolved };
  }

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never`/`undefined` en .rpc() (mismo bug ya documentado en
  // ausencia-actions.ts). El args object ya está tipado por la firma real de
  // la función (supabase/types.ts); el cast acá es seguro.
  const { error } = await supabase.rpc('resolver_pasaje_request', {
    p_request_id: requestId,
    p_accion:     'aprobar',
  } as never);

  if (error) {
    const friendly = translateResolverAusenciaError(error);
    if (friendly) {
      revalidatePath('/aprobaciones');
      return { ok: false, error: friendly };
    }
    console.error('[approvePasaje] error al invocar resolver_pasaje_request:', error.message);
    return { ok: false, error: copy.errors.generic };
  }

  // La resolución ya está commiteada (fuente de verdad); todo lo que sigue
  // (mail) es best-effort y no puede revertirla.
  revalidatePath('/aprobaciones');
  revalidatePath('/solicitud-pasaje');
  revalidatePath('/calendario');

  let emailSent = false;
  try {
    const req = await fetchRequestForNotification(supabase, requestId);
    const owner = req.empleado_profile;
    if (!owner?.email) {
      console.warn(
        `[email] aprobación de pasaje ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendPasajeApprovalEmail({
        to:          owner.email,
        fullName:    owner.full_name,
        motivoViaje: req.motivo_viaje,
        origen:      req.origen,
        destino:     req.destino,
        diasViaje:   req.dias_viaje ?? [],
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar aprobación de pasaje:', emailErr);
  }

  return { ok: true, emailSent };
}

export async function rejectPasaje(requestId: string, motivo: string): Promise<ResolvePasajeResult> {
  const trimmed = motivo.trim();
  if (!trimmed) return { ok: false, error: copy.aprobaciones.rejectModal.motivoRequired };

  await requireAdmin();
  const supabase = await createServerClient();

  if (!(await isPendiente(supabase, requestId))) {
    return { ok: false, error: copy.aprobaciones.messages.alreadyResolved };
  }

  const { error } = await supabase.rpc('resolver_pasaje_request', {
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
    console.error('[rejectPasaje] error al invocar resolver_pasaje_request:', error.message);
    return { ok: false, error: copy.errors.generic };
  }

  revalidatePath('/aprobaciones');
  revalidatePath('/solicitud-pasaje');

  let emailSent = false;
  try {
    const req = await fetchRequestForNotification(supabase, requestId);
    const owner = req.empleado_profile;
    if (!owner?.email) {
      console.warn(
        `[email] rechazo de pasaje ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendPasajeRejectionEmail({
        to:            owner.email,
        fullName:      owner.full_name,
        motivoViaje:   req.motivo_viaje,
        origen:        req.origen,
        destino:       req.destino,
        diasViaje:     req.dias_viaje ?? [],
        motivoRechazo: trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar rechazo de pasaje:', emailErr);
  }

  return { ok: true, emailSent };
}
