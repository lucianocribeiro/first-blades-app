import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { AprobacionesTable, type PendingItem } from './AprobacionesTable';
import type { AusenciaRequest, Document, Profile } from '@/lib/db-types';

type UserProfilePick = Pick<Profile, 'full_name' | 'email'>;

type RawDocument = Document & { user_profile?: UserProfilePick | null };
type RawAusencia = AusenciaRequest & { user_profile?: UserProfilePick | null };

export default async function AprobacionesPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  // Bandeja única: documentos pendientes + días de trámite pendientes, cada
  // uno con join a profiles para mostrar el nombre del solicitante. El saldo
  // derivado (badge "ya consumió N/3 este año") es FB-F3-20; acá solo se lista.
  const [docsResult, ausenciasResult] = await Promise.all([
    supabase
      .from('documents')
      .select('*, user_profile:profiles!documents_user_id_fkey(full_name, email)')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true }),
    supabase
      .from('ausencia_requests')
      .select('*, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)')
      .eq('estado', 'pendiente')
      .eq('motivo_ausencia', 'dia_tramite')
      .order('created_at', { ascending: true }),
  ]);

  const error = docsResult.error || ausenciasResult.error;

  const documents = ((docsResult.data as RawDocument[] | null) ?? []).map(
    (doc): PendingItem => ({ kind: 'documento', data: doc })
  );
  const ausencias = ((ausenciasResult.data as RawAusencia[] | null) ?? []).map(
    (req): PendingItem => ({ kind: 'ausencia', data: req })
  );

  const items = [...documents, ...ausencias].sort((a, b) =>
    a.data.created_at.localeCompare(b.data.created_at)
  );

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
          <AprobacionesTable items={items} />
        )}
      </Card>
    </div>
  );
}
