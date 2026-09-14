import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { contarAprobacionesPendientes } from '@/lib/aprobaciones';
import { AppShell } from '@/components/layout/AppShell';
import { copy } from '@/lib/copy';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAuth();
  const userName = profile.full_name || profile.email || copy.auth.login.welcome;

  // FB-PI-01: contador de la campanita — solo admin. Para supervisor y
  // empleado no se consulta nada ni se pasa número (la misma query, bajo su
  // RLS, devolvería SUS pendientes, no los de la bandeja). Si la lectura
  // falla, el helper ya lo logueó y devuelve null: se degrada a 0 (campanita
  // sin badge) en vez de romper el render del layout.
  let aprobacionesPendientes: number | undefined;
  if (profile.role === 'admin') {
    const supabase = await createServerClient();
    aprobacionesPendientes = (await contarAprobacionesPendientes(supabase)) ?? 0;
  }

  return (
    <AppShell role={profile.role} userName={userName} aprobacionesPendientes={aprobacionesPendientes}>
      {children}
    </AppShell>
  );
}
