import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { AprobacionesTable } from './AprobacionesTable';
import type { Document, Profile } from '@/lib/db-types';

type DocumentWithUser = Document & {
  user_profile?: Pick<Profile, 'full_name' | 'email'> | null;
};

export default async function AprobacionesPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  // Cargar documentos pendientes con join a profiles para mostrar nombre del usuario
  const { data: rawDocs, error } = await supabase
    .from('documents')
    .select('*, user_profile:profiles!documents_user_id_fkey(full_name, email)')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true });

  const documents = (rawDocs as DocumentWithUser[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-secondary">{copy.aprobaciones.title}</h2>
        <p className="text-sm text-neutral mt-0.5">{copy.aprobaciones.subtitle}</p>
      </div>

      <Card padding="sm">
        {error ? (
          <p className="text-error text-sm py-4">{copy.errors.generic}</p>
        ) : (
          <AprobacionesTable documents={documents} />
        )}
      </Card>
    </div>
  );
}
