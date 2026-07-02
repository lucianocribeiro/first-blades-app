// Cableado de producción de las alertas de vencimiento: usa el cliente
// service_role y el transporte real de Gmail. SOLO server-side (lo invoca el
// cron). El core (document-expiry.ts) queda libre de imports server-only para
// poder testearse con dependencias en memoria.
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send-email';
import { createSupabaseExpiryStore } from './document-expiry-store';
import {
  runDocumentExpiryAlerts,
  type ExpiryRunResult,
  type SendEmailFn,
} from './document-expiry';

// Wrappea sendEmail para calzar la firma inyectable del core (sin transporte).
const sendViaGmail: SendEmailFn = (params) => sendEmail(params);

export async function runDocumentExpiryAlertsCron(): Promise<ExpiryRunResult> {
  const client = createAdminClient();
  const store = createSupabaseExpiryStore(client);
  return runDocumentExpiryAlerts({ store, send: sendViaGmail });
}
