// Cableado de producción de las alertas de descanso (FB-F3-13): usa el
// cliente service_role y el transporte real de Gmail. SOLO server-side (lo
// invoca el cron). El core (franco-alerts.ts) queda libre de imports
// server-only para poder testearse con dependencias en memoria.
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send-email';
import { createSupabaseFrancoAlertsStore } from './franco-alerts-store';
import { runFrancoAlerts, type FrancoAlertsRunResult, type SendEmailFn } from './franco-alerts';

const sendViaGmail: SendEmailFn = (params) => sendEmail(params);

export async function runFrancoAlertsCron(): Promise<FrancoAlertsRunResult> {
  const client = createAdminClient();
  const store = createSupabaseFrancoAlertsStore(client);
  return runFrancoAlerts({ store, send: sendViaGmail });
}
