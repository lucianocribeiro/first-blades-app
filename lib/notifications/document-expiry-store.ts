// Implementación Supabase del puerto ExpiryDataStore. Capa fina de acceso a
// datos: cada método es una query acotada explícitamente (el cliente es
// service_role y bypasea RLS, así que el alcance vive en el código). Cubierta
// por tests de integración contra Supabase local.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types';
import type { NotificationLogInsert } from '@/lib/db-types';
import type {
  ExpiryDataStore,
  ExpiryDocument,
  ExpiryRecipient,
  SentThreshold,
} from './document-expiry';

const TIPO = 'vencimiento_documento' as const;

export function createSupabaseExpiryStore(
  client: SupabaseClient<Database>
): ExpiryDataStore {
  return {
    async getApprovedDatedDocuments(): Promise<ExpiryDocument[]> {
      const { data, error } = await client
        .from('documents')
        .select(
          'id, user_id, document_type, certificado_tipo, certificado_otros_texto, fecha_vencimiento'
        )
        .eq('estado', 'aprobado')
        .not('fecha_vencimiento', 'is', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as ExpiryDocument[];
    },

    async getAdmins(): Promise<ExpiryRecipient[]> {
      const { data, error } = await client
        .from('profiles')
        .select('id, email, full_name')
        .eq('role', 'admin');
      if (error) throw new Error(error.message);
      return (data ?? []) as ExpiryRecipient[];
    },

    async getOwners(ids: string[]): Promise<ExpiryRecipient[]> {
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from('profiles')
        .select('id, email, full_name')
        .in('id', ids);
      if (error) throw new Error(error.message);
      return (data ?? []) as ExpiryRecipient[];
    },

    async getSentThresholds(docIds: string[]): Promise<SentThreshold[]> {
      if (docIds.length === 0) return [];
      const { data, error } = await client
        .from('notification_log')
        .select('document_id, umbral, recipient_profile_id')
        .eq('tipo', TIPO)
        .in('document_id', docIds);
      if (error) throw new Error(error.message);
      return (data ?? []) as SentThreshold[];
    },

    async recordSent(rows: SentThreshold[]): Promise<void> {
      if (rows.length === 0) return;
      const inserts: NotificationLogInsert[] = rows.map((r) => ({
        tipo: TIPO,
        document_id: r.document_id,
        umbral: r.umbral,
        recipient_profile_id: r.recipient_profile_id,
      }));
      // Idempotencia: ignora choques con la unique constraint (reintentos/carreras).
      const { error } = await client
        .from('notification_log')
        .upsert(inserts, {
          onConflict: 'tipo,document_id,umbral,recipient_profile_id',
          ignoreDuplicates: true,
        });
      if (error) throw new Error(error.message);
    },
  };
}
