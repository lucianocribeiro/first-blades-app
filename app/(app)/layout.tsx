import { requireAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { copy } from '@/lib/copy';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAuth();
  const userName = profile.full_name || profile.email || copy.auth.login.welcome;

  return (
    <AppShell role={profile.role} userName={userName}>
      {children}
    </AppShell>
  );
}
