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

  const motivo = input.motivo.trim();
  if (!motivo) return { ok: false, error: copy.gestionUsuarios.bajaModal.motivoRequired };
  if (!input.fecha) return { ok: false, error: copy.gestionUsuarios.bajaModal.fechaRequired };

  const admin = createAdminClient();

  const { error } = await admin
    .from('profiles')
    .update({
      status: 'inactivo',
      motivo_baja: motivo,
      fecha_baja: input.fecha,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);

  if (error) return { ok: false, error: error.message };

  // Registrar en audit_log (no bloqueante: si falla, la baja ya se aplicó) —
  // mismo patrón que aprobaciones/actions.ts.
  try {
    await admin.from('audit_log').insert({
      actor_id:   adminProfile.id,
      action:     'user_deactivated',
      table_name: 'profiles',
      record_id:  input.id,
      new_data:   { status: 'inactivo', motivo_baja: motivo, fecha_baja: input.fecha },
    });
  } catch (auditErr) {
    console.error('[audit] fallo al registrar baja de usuario:', auditErr);
  }

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}

export async function activateUser(userId: string): Promise<UserActionResult> {
  const adminProfile = await requireAdmin();
  const admin = createAdminClient();

  // Reactivar limpia motivo_baja/fecha_baja (decisión documentada,
  // FB-F5-08): sin versionado de historial de bajas, un motivo viejo
  // colgado en la ficha después de reactivar confunde más de lo que aporta.
  // La baja anterior queda igual en audit_log si hace falta reconstruirla.
  const { error } = await admin
    .from('profiles')
    .update({
      status: 'activo',
      motivo_baja: null,
      fecha_baja: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };

  try {
    await admin.from('audit_log').insert({
      actor_id:   adminProfile.id,
      action:     'user_activated',
      table_name: 'profiles',
      record_id:  userId,
      new_data:   { status: 'activo' },
    });
  } catch (auditErr) {
    console.error('[audit] fallo al registrar reactivación de usuario:', auditErr);
  }

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}

export async function resetPassword(userId: string, newPassword: string): Promise<UserActionResult> {
  const adminProfile = await requireAdmin();

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.valid) return { ok: false, error: passwordCheck.error! };

  const admin = createAdminClient();

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

  try {
    await admin.from('audit_log').insert({
      actor_id:   adminProfile.id,
      action:     'password_reset',
      table_name: 'profiles',
      record_id:  userId,
    });
  } catch (auditErr) {
    console.error('[audit] fallo al registrar reseteo de contraseña:', auditErr);
  }

  revalidatePath('/gestion-usuarios');
  return { ok: true };
}
