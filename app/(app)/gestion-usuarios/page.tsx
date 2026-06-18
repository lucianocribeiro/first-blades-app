import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import type { Tables } from '@/supabase/types';
import { UserTable } from './UserTable';
import { CreateUserButton } from './CreateUserButton';

export default async function GestionUsuariosPage() {
  // requireAdmin redirige si no es admin
  await requireAdmin();

  const supabase = await createServerClient();

  const result = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true });

  const users = (result.data as Tables<'profiles'>[] | null) ?? [];
  const error = result.error;

  if (error) {
    return (
      <Card>
        <p className="text-error">{copy.errors.generic}</p>
      </Card>
    );
  }

  const supervisors = users.filter(
    (u) => u.role === 'supervisor' || u.role === 'admin'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-secondary">
            {copy.gestionUsuarios.title}
          </h2>
          <p className="text-sm text-neutral mt-0.5">
            {copy.gestionUsuarios.subtitle}
          </p>
        </div>
        <CreateUserButton supervisors={supervisors} />
      </div>

      <Card padding="sm">
        <UserTable users={users} supervisors={supervisors} />
      </Card>
    </div>
  );
}
