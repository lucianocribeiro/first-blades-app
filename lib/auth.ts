import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/roles';
import type { Tables } from '@/supabase/types';

export type SessionProfile = Tables<'profiles'>;

export async function requireAuth(): Promise<SessionProfile> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const result = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const profile = result.data as Tables<'profiles'> | null;

  if (!profile) redirect('/login');

  return profile;
}

export async function requireRole(role: UserRole): Promise<SessionProfile> {
  const profile = await requireAuth();
  if (profile.role !== role) redirect('/dashboard');
  return profile;
}

export async function requireAdmin(): Promise<SessionProfile> {
  return requireRole('admin');
}
