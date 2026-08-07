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

  // Gate de acceso (FB-F5-08): solo status='activo' entra. `inactivo` y
  // `pendiente` quedan afuera aunque el JWT siga siendo técnicamente válido
  // (p.ej. alguien inactivado mientras ya estaba navegando). `signOut()`
  // revoca la sesión del lado del servidor (scope 'global' por default en
  // auth-js): el próximo `getUser()` —incluido el que hace el middleware,
  // aunque la cookie local no se haya podido reescribir acá porque un
  // Server Component no puede escribir cookies— devuelve user:null. Eso es
  // lo que evita un loop /login↔/dashboard (middleware redirige lejos de
  // /login mientras vea `user` truthy). El mensaje en /login es el mismo
  // genérico de sesión expirada sin importar el motivo real (sin sesión,
  // sin perfil, o inactivo/pendiente) — así nadie que adivine una
  // contraseña correcta de una cuenta dada de baja se entera de que acertó.
  if (profile.status !== 'activo') {
    await supabase.auth.signOut();
    redirect('/login?motivo=acceso');
  }

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

export async function requireSupervisor(): Promise<SessionProfile> {
  return requireRole('supervisor');
}
