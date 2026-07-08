// Implementación Supabase del puerto FrancoAlertsDataStore (FB-F3-13). Capa
// fina de acceso a datos: cada método es una query acotada explícitamente
// (el cliente es service_role y bypasea RLS, así que el alcance vive en el
// código, mismo patrón que document-expiry-store.ts). Cubierta por tests de
// integración contra Supabase local.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types';
import type { FrancoAlertaDia, FrancoAlertRow, FrancoAlertTipo } from '@/app/(app)/calendario/francoAlerts';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';
import type {
  FrancoAlertRecipient,
  FrancoAlertsDataStore,
  SentFrancoAlert,
} from './franco-alerts';

// ── Tipado temporal de notification_log ────────────────────────────────────
// supabase/types.ts todavía NO refleja las migraciones 0010/0011 (enum
// ampliado + empleado_id + racha_inicio + document_id nullable): la
// regeneración `--linked` queda para el runbook post-auditoría de esquema
// (ver docs/prompts/FB-F3-13.md — a propósito no se pushea ni regenera acá).
// Este tipo espeja EXACTAMENTE el delta de esas migraciones, acotado a este
// archivo; se puede borrar en cuanto se regenere supabase/types.ts.
// Nota: las secciones vacías usan `{ [_ in never]: never }` (no
// `Record<string, never>`) — un index signature ahí hace que `.from()`
// resuelva mal el overload de Views en vez de Tables.
type FrancoNotificationLogRow = {
  id: string;
  tipo: FrancoAlertTipo;
  document_id: null;
  umbral: number;
  recipient_profile_id: string;
  empleado_id: string;
  racha_inicio: string;
  sent_at: string;
};
type FrancoNotificationLogInsert = {
  id?: string;
  tipo: FrancoAlertTipo;
  document_id?: null;
  umbral: number;
  recipient_profile_id: string;
  empleado_id: string;
  racha_inicio: string;
  sent_at?: string;
};
type FrancoShadowDatabase = {
  public: {
    Tables: {
      notification_log: {
        Row: FrancoNotificationLogRow;
        Insert: FrancoNotificationLogInsert;
        Update: Partial<FrancoNotificationLogInsert>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

function francoNotificationLog(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<FrancoShadowDatabase>).from('notification_log');
}

// Postgres SQLSTATE de unique_violation. La idempotencia real vive en el
// chequeo de `getSentAlerts` antes de enviar (ver franco-alerts.ts); esta
// constraint es la red de seguridad ante reintentos/carreras, así que un
// choque acá se ignora en vez de propagarse como error.
const UNIQUE_VIOLATION = '23505';

export function createSupabaseFrancoAlertsStore(
  client: SupabaseClient<Database>
): FrancoAlertsDataStore {
  return {
    async getActiveEmployees(): Promise<RosterEmployee[]> {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, email')
        .eq('status', 'activo')
        .in('role', ['empleado', 'supervisor']);
      if (error) throw new Error(error.message);
      return (data ?? []) as RosterEmployee[];
    },

    async getAdmins(): Promise<FrancoAlertRecipient[]> {
      const { data, error } = await client
        .from('profiles')
        .select('id, email, full_name')
        .eq('role', 'admin');
      if (error) throw new Error(error.message);
      return (data ?? []) as FrancoAlertRecipient[];
    },

    async getRecentDias(
      employeeIds: string[],
      windowStart: string,
      today: string
    ): Promise<FrancoAlertaDia[]> {
      if (employeeIds.length === 0) return [];
      const { data, error } = await client
        .from('rotation_assignments')
        .select('user_id, fecha, estado_dia, es_estimado')
        .in('user_id', employeeIds)
        .gte('fecha', windowStart)
        .lte('fecha', today);
      if (error) throw new Error(error.message);
      return (data ?? []) as FrancoAlertaDia[];
    },

    async getSentAlerts(rows: FrancoAlertRow[]): Promise<SentFrancoAlert[]> {
      if (rows.length === 0) return [];
      const employeeIds = Array.from(new Set(rows.map((r) => r.employeeId)));
      const { data, error } = await francoNotificationLog(client)
        .select('empleado_id, tipo, umbral, racha_inicio, recipient_profile_id')
        .is('document_id', null)
        .in('empleado_id', employeeIds);
      if (error) throw new Error(error.message);
      return (data ?? []) as SentFrancoAlert[];
    },

    async recordSent(rows: SentFrancoAlert[]): Promise<void> {
      if (rows.length === 0) return;
      const inserts: FrancoNotificationLogInsert[] = rows.map((r) => ({
        tipo: r.tipo,
        empleado_id: r.empleado_id,
        umbral: r.umbral,
        racha_inicio: r.racha_inicio,
        recipient_profile_id: r.recipient_profile_id,
        document_id: null,
      }));
      const { error } = await francoNotificationLog(client).insert(inserts);
      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
    },
  };
}
