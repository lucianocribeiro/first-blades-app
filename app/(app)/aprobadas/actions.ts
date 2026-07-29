'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { translateCancelarEditarError, validateFechasEdicionAusencia, validateDiasEdicionPasaje } from './logic';
import {
  sendAusenciaCanceladaEmail,
  sendAusenciaEditadaEmail,
} from '@/lib/email/ausencia-post-aprobacion-email';
import {
  sendPasajeCanceladoEmail,
  sendPasajeEditadoEmail,
} from '@/lib/email/pasaje-post-aprobacion-email';
import type { MotivoAusencia, MotivoViaje } from '@/lib/db-types';
import type { OverwriteDay, OverwriteStatus } from '@/lib/rotation/overwrite-status';

// cancelar_editar_ausencia_aprobada / cancelar_editar_pasaje_aprobado (0017)
// son SECURITY DEFINER y validan admin por dentro leyendo auth.uid(): igual
// que resolver_ausencia_request/resolver_pasaje_request, necesitan la sesión
// real del admin (createServerClient()), no un cliente service_role.
type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>;

export type CancelarEditarResult = { emailSent: boolean };

type AusenciaForAction = {
  estado: string;
  post_aprobacion_tipo: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  motivo_ausencia: MotivoAusencia;
  motivo_otros_texto: string | null;
  user_profile: { full_name: string | null; email: string | null } | null;
};

type PasajeForAction = {
  estado: string;
  post_aprobacion_tipo: string | null;
  motivo_viaje: MotivoViaje;
  origen: string;
  destino: string;
  dias_viaje: string[] | null;
  empleado_profile: { full_name: string | null; email: string | null } | null;
};

// Re-lee la solicitud ANTES de invocar la RPC: la RPC valida admin + estado
// aprobado + no-ya-cancelada por dentro, pero esta re-lectura server-side da
// un error amigable de "ya no vigente" sin depender del texto crudo de
// Postgres, y de paso trae los datos que el mail necesita (fechas/motivo
// ANTERIORES a la edición, y el perfil del dueño) — capa de app superpuesta
// a la RPC, no la reemplaza; la RPC sigue siendo la autoridad real (mismo
// criterio que aprobaciones/ausencia-actions.ts::assertPendiente).
async function fetchAusenciaForAction(
  supabase: ServerSupabase,
  requestId: string
): Promise<AusenciaForAction> {
  const { data, error } = await supabase
    .from('ausencia_requests')
    .select(
      'estado, post_aprobacion_tipo, fecha_inicio, fecha_fin, motivo_ausencia, motivo_otros_texto, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)'
    )
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw new Error(copy.aprobadas.errors.yaNoVigente);
  }
  return data as unknown as AusenciaForAction;
}

async function fetchPasajeForAction(
  supabase: ServerSupabase,
  requestId: string
): Promise<PasajeForAction> {
  const { data, error } = await supabase
    .from('pasaje_requests')
    .select(
      'estado, post_aprobacion_tipo, motivo_viaje, origen, destino, dias_viaje, empleado_profile:profiles!pasaje_requests_empleado_id_fkey(full_name, email)'
    )
    .eq('id', requestId)
    .single();

  if (error || !data) {
    throw new Error(copy.aprobadas.errors.yaNoVigente);
  }
  return data as unknown as PasajeForAction;
}

function assertAprobadaVigente(row: { estado: string; post_aprobacion_tipo: string | null }): void {
  if (row.estado !== 'aprobado' || row.post_aprobacion_tipo === 'cancelada') {
    throw new Error(copy.aprobadas.errors.yaNoVigente);
  }
}

// ─── Ausencia: cancelar ─────────────────────────────────────────────────

export async function cancelarAusencia(requestId: string, comentario: string): Promise<CancelarEditarResult> {
  const trimmed = comentario.trim();
  if (!trimmed) throw new Error(copy.aprobadas.cancelModal.comentarioRequired);

  await requireAdmin();
  const supabase = await createServerClient();

  const req = await fetchAusenciaForAction(supabase, requestId);
  assertAprobadaVigente(req);

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never`/`undefined` en .rpc() (mismo bug ya documentado en
  // aprobaciones/ausencia-actions.ts). El args object ya está tipado por la
  // firma real de la función (supabase/types.ts); el cast acá es seguro.
  const { error } = await supabase.rpc('cancelar_editar_ausencia_aprobada', {
    p_request_id: requestId,
    p_accion:     'cancelar',
    p_comentario: trimmed,
  } as never);

  if (error) {
    const friendly = translateCancelarEditarError(error);
    if (friendly) {
      revalidatePath('/aprobadas');
      throw new Error(friendly);
    }
    console.error('[cancelarAusencia] error al invocar cancelar_editar_ausencia_aprobada:', error.message);
    throw new Error(copy.aprobadas.errors.generic);
  }

  // La cancelación ya está commiteada (fuente de verdad); todo lo que sigue
  // (mail) es best-effort y no puede revertirla.
  revalidatePath('/aprobadas');
  revalidatePath('/solicitud-ausencia');
  revalidatePath('/calendario');

  let emailSent = false;
  try {
    const owner = req.user_profile;
    if (!owner?.email) {
      console.warn(
        `[email] cancelación de ausencia ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendAusenciaCanceladaEmail({
        to:               owner.email,
        fullName:         owner.full_name,
        fechaInicio:      req.fecha_inicio,
        fechaFin:         req.fecha_fin,
        motivoAusencia:   req.motivo_ausencia,
        motivoOtrosTexto: req.motivo_otros_texto,
        comentario:       trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar cancelación de ausencia:', emailErr);
  }

  return { emailSent };
}

// ─── Ausencia: editar fechas ────────────────────────────────────────────

export async function editarFechasAusencia(
  requestId: string,
  comentario: string,
  fechaInicio: string,
  fechaFin: string
): Promise<CancelarEditarResult> {
  const trimmed = comentario.trim();
  if (!trimmed) throw new Error(copy.aprobadas.editModal.comentarioRequired);

  const validation = validateFechasEdicionAusencia(fechaInicio, fechaFin);
  if (!validation.valid) throw new Error(validation.error);

  await requireAdmin();
  const supabase = await createServerClient();

  const req = await fetchAusenciaForAction(supabase, requestId);
  assertAprobadaVigente(req);

  const { error } = await supabase.rpc('cancelar_editar_ausencia_aprobada', {
    p_request_id:          requestId,
    p_accion:               'editar_fechas',
    p_comentario:            trimmed,
    p_nueva_fecha_inicio:   fechaInicio,
    p_nueva_fecha_fin:      fechaFin,
  } as never);

  if (error) {
    const friendly = translateCancelarEditarError(error);
    if (friendly) {
      revalidatePath('/aprobadas');
      throw new Error(friendly);
    }
    console.error('[editarFechasAusencia] error al invocar cancelar_editar_ausencia_aprobada:', error.message);
    throw new Error(copy.aprobadas.errors.generic);
  }

  revalidatePath('/aprobadas');
  revalidatePath('/solicitud-ausencia');
  revalidatePath('/calendario');

  let emailSent = false;
  try {
    const owner = req.user_profile;
    if (!owner?.email) {
      console.warn(
        `[email] edición de ausencia ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendAusenciaEditadaEmail({
        to:                   owner.email,
        fullName:             owner.full_name,
        fechaInicioAnterior:  req.fecha_inicio,
        fechaFinAnterior:     req.fecha_fin,
        fechaInicioNueva:     fechaInicio,
        fechaFinNueva:        fechaFin,
        motivoAusencia:       req.motivo_ausencia,
        motivoOtrosTexto:     req.motivo_otros_texto,
        comentario:           trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar edición de ausencia:', emailErr);
  }

  return { emailSent };
}

// ─── Pasaje: cancelar ───────────────────────────────────────────────────

export async function cancelarPasaje(requestId: string, comentario: string): Promise<CancelarEditarResult> {
  const trimmed = comentario.trim();
  if (!trimmed) throw new Error(copy.aprobadas.cancelModal.comentarioRequired);

  await requireAdmin();
  const supabase = await createServerClient();

  const req = await fetchPasajeForAction(supabase, requestId);
  assertAprobadaVigente(req);

  const { error } = await supabase.rpc('cancelar_editar_pasaje_aprobado', {
    p_request_id: requestId,
    p_accion:     'cancelar',
    p_comentario: trimmed,
  } as never);

  if (error) {
    const friendly = translateCancelarEditarError(error);
    if (friendly) {
      revalidatePath('/aprobadas');
      throw new Error(friendly);
    }
    console.error('[cancelarPasaje] error al invocar cancelar_editar_pasaje_aprobado:', error.message);
    throw new Error(copy.aprobadas.errors.generic);
  }

  revalidatePath('/aprobadas');
  revalidatePath('/solicitud-pasaje');
  revalidatePath('/calendario');

  let emailSent = false;
  try {
    const owner = req.empleado_profile;
    if (!owner?.email) {
      console.warn(
        `[email] cancelación de pasaje ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendPasajeCanceladoEmail({
        to:          owner.email,
        fullName:    owner.full_name,
        motivoViaje: req.motivo_viaje,
        origen:      req.origen,
        destino:     req.destino,
        diasViaje:   req.dias_viaje ?? [],
        comentario:  trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar cancelación de pasaje:', emailErr);
  }

  return { emailSent };
}

// ─── Pasaje: editar fechas (días discretos) ─────────────────────────────

export async function editarFechasPasaje(
  requestId: string,
  comentario: string,
  diasViaje: string[]
): Promise<CancelarEditarResult> {
  const trimmed = comentario.trim();
  if (!trimmed) throw new Error(copy.aprobadas.editModal.comentarioRequired);

  const validation = validateDiasEdicionPasaje(diasViaje);
  if (!validation.valid) throw new Error(validation.error);

  await requireAdmin();
  const supabase = await createServerClient();

  const req = await fetchPasajeForAction(supabase, requestId);
  assertAprobadaVigente(req);

  const diasOrdenados = [...new Set(diasViaje)].sort();

  const { error } = await supabase.rpc('cancelar_editar_pasaje_aprobado', {
    p_request_id: requestId,
    p_accion:     'editar_fechas',
    p_comentario: trimmed,
    p_nuevos_dias: diasOrdenados,
  } as never);

  if (error) {
    const friendly = translateCancelarEditarError(error);
    if (friendly) {
      revalidatePath('/aprobadas');
      throw new Error(friendly);
    }
    console.error('[editarFechasPasaje] error al invocar cancelar_editar_pasaje_aprobado:', error.message);
    throw new Error(copy.aprobadas.errors.generic);
  }

  revalidatePath('/aprobadas');
  revalidatePath('/solicitud-pasaje');
  revalidatePath('/calendario');

  let emailSent = false;
  try {
    const owner = req.empleado_profile;
    if (!owner?.email) {
      console.warn(
        `[email] edición de pasaje ${requestId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendPasajeEditadoEmail({
        to:                   owner.email,
        fullName:             owner.full_name,
        motivoViaje:          req.motivo_viaje,
        origen:               req.origen,
        destino:              req.destino,
        diasViajeAnteriores:  req.dias_viaje ?? [],
        diasViajeNuevos:      diasOrdenados,
        comentario:           trimmed,
      });
      emailSent = true;
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar edición de pasaje:', emailErr);
  }

  return { emailSent };
}

// ─── Previsualización de sobrescritura (editar) ─────────────────────────
// Mismo contrato OverwriteStatus que la cola de Aprobaciones (FB-F4-06), pero
// acá se calcula on-demand (no en el render de la página): las fechas nuevas
// las elige el admin en vivo en el modal, así que no existen todavía cuando
// se arma /aprobadas. Se recibe requestId (no un userId suelto) para que el
// server derive el empleado dueño del calendario — evita confiar en un
// userId que el cliente podría desincronizar del request real.

export async function previewOverwriteAusencia(
  requestId: string,
  fechaInicio: string,
  fechaFin: string
): Promise<OverwriteStatus> {
  await requireAdmin();
  const supabase = await createServerClient();

  const { data: reqRow, error: reqError } = await supabase
    .from('ausencia_requests')
    .select('user_id')
    .eq('id', requestId)
    .single();

  if (reqError || !reqRow) {
    console.error('[previewOverwriteAusencia] no se encontró la solicitud:', reqError?.message);
    return { status: 'error' };
  }
  const userId = (reqRow as unknown as { user_id: string }).user_id;

  const { data, error } = await supabase
    .from('rotation_assignments')
    .select('fecha, estado_dia, es_estimado')
    .eq('user_id', userId)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin);

  if (error) {
    console.error('[previewOverwriteAusencia] error al previsualizar:', error.message);
    return { status: 'error' };
  }
  return { status: 'ok', days: (data ?? []) as OverwriteDay[] };
}

export async function previewOverwritePasaje(
  requestId: string,
  diasViaje: string[]
): Promise<OverwriteStatus> {
  await requireAdmin();
  if (diasViaje.length === 0) return { status: 'ok', days: [] };

  const supabase = await createServerClient();

  const { data: reqRow, error: reqError } = await supabase
    .from('pasaje_requests')
    .select('empleado_id')
    .eq('id', requestId)
    .single();

  if (reqError || !reqRow) {
    console.error('[previewOverwritePasaje] no se encontró la solicitud:', reqError?.message);
    return { status: 'error' };
  }
  const empleadoId = (reqRow as unknown as { empleado_id: string }).empleado_id;

  const { data, error } = await supabase
    .from('rotation_assignments')
    .select('fecha, estado_dia, es_estimado')
    .eq('user_id', empleadoId)
    .in('fecha', diasViaje);

  if (error) {
    console.error('[previewOverwritePasaje] error al previsualizar:', error.message);
    return { status: 'error' };
  }
  return { status: 'ok', days: (data ?? []) as OverwriteDay[] };
}
