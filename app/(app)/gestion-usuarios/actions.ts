'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { UserRole } from '@/lib/roles';
import type { EmployeeStatus } from '@/lib/db-types';

export type CreateUserInput = {
  email: string;
  full_name: string;
  role: UserRole;
  supervisor_id?: string;
  initial_password: string;
};

export async function createUser(input: CreateUserInput) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.initial_password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });

  if (authError) throw new Error(authError.message);

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: input.full_name,
      role: input.role,
      supervisor_id: input.role === 'empleado' ? (input.supervisor_id ?? null) : null,
    })
    .eq('id', data.user.id);

  if (profileError) throw new Error(profileError.message);

  revalidatePath('/gestion-usuarios');
}

export type UpdateUserInput = {
  id: string;
  full_name: string;
  role: UserRole;
  supervisor_id?: string;
  status: EmployeeStatus;
};

export async function updateUser(input: UpdateUserInput) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from('profiles')
    .update({
      full_name: input.full_name,
      role: input.role,
      status: input.status,
      supervisor_id: input.role === 'empleado' ? (input.supervisor_id ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);

  if (error) throw new Error(error.message);

  revalidatePath('/gestion-usuarios');
}

export async function setUserStatus(userId: string, status: EmployeeStatus) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw new Error(error.message);

  revalidatePath('/gestion-usuarios');
}
