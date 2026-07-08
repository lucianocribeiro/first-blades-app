// Núcleo del cron de alertas de descanso por mail (FB-F3-13). Reutiliza
// computeFrancoAlerts (app/(app)/calendario/francoAlerts.ts) para detectar
// quién está en alerta y en qué umbral — la lógica de racha vive ahí y NO
// se duplica acá. Este módulo solo orquesta: quién recibe el mail (solo
// admins), idempotencia por episodio y envío con marca-después-de-enviar.
// Agnóstico de infraestructura: recibe un store y un `send` inyectables,
// para testearse en unit sin tocar red ni BD (mismo patrón que
// document-expiry.ts). La implementación Supabase vive en
// franco-alerts-store.ts.
import {
  computeFrancoAlerts,
  getFrancoAlertWindowStart,
  type FrancoAlertaDia,
  type FrancoAlertRow,
  type FrancoAlertTipo,
} from '@/app/(app)/calendario/francoAlerts';
import { getBusinessToday } from '@/lib/rotation/promote-estimated';
import { buildFrancoAlertEmail } from './franco-alerts-email';
import type { SendEmailParams } from '@/lib/email/send-email';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';

export interface FrancoAlertRecipient {
  id: string;
  email: string | null;
  full_name: string | null;
}

export interface SentFrancoAlert {
  empleado_id: string;
  tipo: FrancoAlertTipo;
  umbral: number;
  racha_inicio: string;
  recipient_profile_id: string;
}

export interface FrancoAlertsDataStore {
  // Empleados activos en scope (empleado/supervisor) — mismo scope que ve
  // el admin en el panel in-app.
  getActiveEmployees(): Promise<RosterEmployee[]>;
  getAdmins(): Promise<FrancoAlertRecipient[]>;
  // Días reales (es_estimado excluido en el store) de rotation_assignments
  // en la ventana [windowStart, today], acotado a `employeeIds`.
  getRecentDias(employeeIds: string[], windowStart: string, today: string): Promise<FrancoAlertaDia[]>;
  // Episodios ya notificados para las filas de alerta vigentes (idempotencia).
  getSentAlerts(rows: FrancoAlertRow[]): Promise<SentFrancoAlert[]>;
  // Registra episodios recién notificados. Idempotente: una violación de la
  // unicidad (reintento/carrera) no debe propagarse como error.
  recordSent(rows: SentFrancoAlert[]): Promise<void>;
}

export type SendEmailFn = (params: SendEmailParams) => Promise<void>;

export interface FrancoAlertsRunResult {
  employeesInAlert: number;
  sent: number;
  failed: number;
}

export interface RunDeps {
  store: FrancoAlertsDataStore;
  send: SendEmailFn;
  // Fecha de referencia YYYY-MM-DD; por defecto "hoy" en zona AR.
  today?: string;
}

function sentKey(s: {
  tipo: FrancoAlertTipo;
  empleado_id: string;
  umbral: number;
  racha_inicio: string;
  recipient_profile_id: string;
}): string {
  return `${s.tipo}|${s.empleado_id}|${s.umbral}|${s.racha_inicio}|${s.recipient_profile_id}`;
}

export async function runFrancoAlerts(deps: RunDeps): Promise<FrancoAlertsRunResult> {
  const { store, send } = deps;
  const today = deps.today ?? getBusinessToday();

  const result: FrancoAlertsRunResult = { employeesInAlert: 0, sent: 0, failed: 0 };

  const employees = await store.getActiveEmployees();
  if (employees.length === 0) return result;

  const windowStart = getFrancoAlertWindowStart(today);
  const employeeIds = employees.map((e) => e.id);
  const dias = await store.getRecentDias(employeeIds, windowStart, today);

  const rows = computeFrancoAlerts(employees, dias, today);
  result.employeesInAlert = new Set(rows.map((r) => r.employeeId)).size;
  if (rows.length === 0) return result;

  const admins = await store.getAdmins();
  if (admins.length === 0) return result;

  const sentRows = await store.getSentAlerts(rows);
  const sentSet = new Set(sentRows.map(sentKey));

  // Envía (si corresponde) a un admin y marca DESPUÉS de enviar. Fallo de
  // envío → no registra → se reintenta la próxima corrida. Fallo aislado →
  // no bloquea a los demás destinatarios ni a las demás filas.
  async function notify(row: FrancoAlertRow, admin: FrancoAlertRecipient): Promise<void> {
    const pending: SentFrancoAlert = {
      empleado_id: row.employeeId,
      tipo: row.tipo,
      umbral: row.umbral,
      racha_inicio: row.rachaInicio,
      recipient_profile_id: admin.id,
    };
    if (sentSet.has(sentKey(pending))) return; // ya notificado este episodio/umbral

    if (!admin.email) {
      console.warn(
        `[franco-alerts] admin ${admin.id} sin email; se omite el envío (empleado ${row.employeeId}).`
      );
      return;
    }

    try {
      await send(
        buildFrancoAlertEmail({
          to: admin.email,
          empleadoName: row.fullName || row.email,
          tipo: row.tipo,
          valor: row.valor,
        })
      );
    } catch (err) {
      console.error(
        `[franco-alerts] fallo al enviar a admin ${admin.id} (empleado ${row.employeeId}):`,
        err
      );
      result.failed += 1;
      return;
    }

    try {
      await store.recordSent([pending]);
    } catch (err) {
      // El email ya salió; loguear visible el fallo de registro (no silencioso).
      console.error(
        `[franco-alerts] alerta enviada pero falló el registro (empleado ${row.employeeId}, admin ${admin.id}):`,
        err
      );
    }
    sentSet.add(sentKey(pending));
    result.sent += 1;
  }

  for (const row of rows) {
    for (const admin of admins) {
      await notify(row, admin);
    }
  }

  return result;
}
