'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePassword } from '@/lib/password';
import { copy } from '@/lib/copy';
import type { UserRole } from '@/lib/roles';

// Contrato return-based (constitución §2.5): nunca throw para un error
// esperado — un throw que cruza el límite de una Server Action se redacta
// en build de producción. Los call sites chequean `!ok`.
export type UserActionResult = { ok: true } | { ok: false; error: string };
export type CreateUserResult = { ok: true; id: string } | { ok: false; error: string };

// requireAdmin() corta con redirect('/dashboard') si quien llama no es
// admin — no devuelve { ok: false } (misma excepción documentada que
// procedimientos/actions.ts, FB-F5-AUD-05 Hallazgo 3). El contrato { ok }
// aplica a partir de ahí, a los errores de negocio de una llamada ya
// autorizada.

export type CreateUserInput = {
  email: string;
  full_name: string;
  role: UserRole;
  supervisor_id?: string;
  initial_password: string;
};

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  await requireAdmin();

  const passwordCheck = validatePassword(input.initial_password);
  if (!passwordCheck.valid) return { ok: false, error: passwordCheck.error! };

  const admin = createAdminClient();

  const { data, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.initial_password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });

  if (authError) return { ok: false, error: authError.message };

  // status explícito, no el DEFAULT 'activo' de la columna: con el gate de
  // acceso de FB-F5-08 (requireAuth() solo deja entrar a status='activo'),
  // un alta que no setee esto a propósito quedaría a merced de que nadie
  // cambie el default de la tabla más adelante.
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: input.full_name,
      role: input.role,
      status: 'activo',
      supervisor_id: input.role === 'empleado' ? (input.supervisor_id ?? null) : null,
    })
    .eq('id', data.user.id);

  if (profileError) return { ok: false, error: profileError.message };

  revalidatePath('/gestion-usuarios');
  return { ok: true, id: data.user.id };
}

export type UpdateUserInput = {
  id: string;
  full_name: string;
  role: UserRole;
  supervisor_id?: string;
};

export async function updateUser(input: UpdateUserInput): Promise<UserActionResult> {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from('profiles')
    .update({
      full_name: input.full_name,
      role: input.role,
      supervisor_id: input.role === 'empleado' ? (input.supervisor_id ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}

export type DeactivateUserInput = {
  id: string;
  motivo: string;
  fecha: string;
};

export async function deactivateUser(input: DeactivateUserInput): Promise<UserActionResult> {
  const adminProfile = await requireAdmin();

  // Hardening del usuario objetivo (FB-F5-09, Hallazgo 3, bloqueante): un
  // admin no puede desactivarse a sí mismo. Si fuera el único admin, quedaría
  // sin acceso en el acto y sin nadie que pueda reactivarlo desde la app —
  // estado irrecuperable. Comparación server-side contra el id de la sesión
  // YA verificada por requireAdmin(), nunca contra algo que venga del
  // cliente. Desactivar a OTRO admin sigue permitido: es una operación
  // legítima, el único caso irrecuperable es este.
  if (input.id === adminProfile.id) {
    return { ok: false, error: copy.gestionUsuarios.errors.cannotDeactivateSelf };
  }

  const motivo = input.motivo.trim();
  if (!motivo) return { ok: false, error: copy.gestionUsuarios.bajaModal.motivoRequired };
  if (!input.fecha) return { ok: false, error: copy.gestionUsuarios.bajaModal.fechaRequired };

  const admin = createAdminClient();

  // Releer el perfil objetivo del lado del server (Hallazgo 3): un id
  // inexistente no debe devolver { ok: true } ni escribir en audit_log sobre
  // un record_id que nunca existió.
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', input.id)
    .maybeSingle();

  if (!targetProfile) {
    return { ok: false, error: copy.gestionUsuarios.errors.userNotFound };
  }

  const { data: updated, error } = await admin
    .from('profiles')
    .update({
      status: 'inactivo',
      motivo_baja: motivo,
      fecha_baja: input.fecha,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .select('id');

  if (error) return { ok: false, error: error.message };

  // Cero filas afectadas es un error, no un éxito silencioso (Hallazgo 3).
  if (!updated || updated.length === 0) {
    return { ok: false, error: copy.gestionUsuarios.errors.updateFailed };
  }

  // Registrar en audit_log (no bloqueante: si falla, la baja ya se aplicó).
  // FB-F5-09 Hallazgo 2: leer el resultado — insert() de PostgREST no
  // throwea por un fallo de query, lo devuelve como { error }. Un try/catch
  // acá nunca lo agarra; antes esto tragaba el fallo sin dejar rastro.
  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id:   adminProfile.id,
    action:     'user_deactivated',
    table_name: 'profiles',
    record_id:  input.id,
    new_data:   { status: 'inactivo', motivo_baja: motivo, fecha_baja: input.fecha },
  });
  if (auditError) {
    console.error('[audit] fallo al registrar baja de usuario:', {
      actorId: adminProfile.id,
      targetId: input.id,
      error: auditError,
    });
  }

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}

export async function activateUser(userId: string): Promise<UserActionResult> {
  const adminProfile = await requireAdmin();
  const admin = createAdminClient();

  // Releer el perfil objetivo del lado del server (Hallazgo 3, FB-F5-09): un
  // id inexistente no debe devolver { ok: true } ni escribir en audit_log.
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!targetProfile) {
    return { ok: false, error: copy.gestionUsuarios.errors.userNotFound };
  }

  // Reactivar limpia motivo_baja/fecha_baja (decisión documentada,
  // FB-F5-08): sin versionado de historial de bajas, un motivo viejo
  // colgado en la ficha después de reactivar confunde más de lo que aporta.
  // La baja anterior queda igual en audit_log si hace falta reconstruirla.
  const { data: updated, error } = await admin
    .from('profiles')
    .update({
      status: 'activo',
      motivo_baja: null,
      fecha_baja: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id');

  if (error) return { ok: false, error: error.message };

  // Cero filas afectadas es un error, no un éxito silencioso (Hallazgo 3).
  if (!updated || updated.length === 0) {
    return { ok: false, error: copy.gestionUsuarios.errors.updateFailed };
  }

  // FB-F5-09 Hallazgo 2: leer el resultado del insert, no un try/catch — ver
  // el comentario equivalente en deactivateUser.
  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id:   adminProfile.id,
    action:     'user_activated',
    table_name: 'profiles',
    record_id:  userId,
    new_data:   { status: 'activo' },
  });
  if (auditError) {
    console.error('[audit] fallo al registrar reactivación de usuario:', {
      actorId: adminProfile.id,
      targetId: userId,
      error: auditError,
    });
  }

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}

export async function resetPassword(userId: string, newPassword: string): Promise<UserActionResult> {
  const adminProfile = await requireAdmin();

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.valid) return { ok: false, error: passwordCheck.error! };

  const admin = createAdminClient();

  // Confirmar que userId corresponde a un perfil gestionado por la app
  // (Hallazgo 3, FB-F5-09) — antes de tocar Supabase Auth. Evita resetear la
  // contraseña de un usuario de Auth que no tiene fila en `profiles` (o que
  // ya no la tiene) a través de esta pantalla.
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!targetProfile) {
    return { ok: false, error: copy.gestionUsuarios.errors.userNotFound };
  }

  // ─── Excepción documentada: admin client fuera de un job de sistema ───
  // Cambiar la contraseña de otro usuario SOLO se puede hacer con
  // supabase.auth.admin.updateUserById(), que exige el admin client
  // (service_role) — no hay otro camino en Supabase Auth. Por eso acá el
  // admin client se alcanza recién DESPUÉS de que requireAdmin() confirmó
  // por sesión (createServerClient()) que quien llama es admin — nunca
  // antes, y nunca desde un camino que no pase por esa verificación.
  //
  // audit_log: 0020 le sacó a log_audit() el permiso de ser invocada por
  // `authenticated`, y audit_log no tiene policy de INSERT — el único
  // camino de escritura para código de servidor es el admin client
  // (service_role bypassea RLS). Insertamos directo en la tabla (mismo
  // patrón que aprobaciones/actions.ts: approveDocument), con actor_id
  // tomado de `adminProfile.id` (la sesión YA verificada arriba) — nunca
  // del parámetro `userId` (sería el afectado, no el actor) ni de
  // auth.uid() (no existe con service_role, quedaría NULL: una auditoría
  // sin autor es peor que no tenerla).
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { ok: false, error: error.message };

  // FB-F5-09 Hallazgo 2: leer el resultado del insert, no un try/catch — el
  // insert() de PostgREST no throwea por un fallo de query, lo devuelve como
  // { error }; antes esto tragaba el fallo sin dejar rastro.
  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id:   adminProfile.id,
    action:     'password_reset',
    table_name: 'profiles',
    record_id:  userId,
  });
  if (auditError) {
    console.error('[audit] fallo al registrar reseteo de contraseña:', {
      actorId: adminProfile.id,
      targetId: userId,
      error: auditError,
    });
  }

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}
