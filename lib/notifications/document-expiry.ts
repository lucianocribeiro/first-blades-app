// Núcleo de las alertas de vencimiento de documentos (FB-F2-07).
// Contiene TODA la lógica de umbrales, idempotencia y destinatarios. Es
// agnóstico de infraestructura: recibe un `ExpiryDataStore` (puerto de datos) y
// una función `send` inyectables, para testearse en unit sin tocar red ni BD.
// La implementación Supabase del store vive en document-expiry-store.ts.
import {
  getDiasRestantes,
  formatDocTypeLabel,
} from '@/app/(app)/equipo/utils';
import {
  buildEmployeeExpiryEmail,
  buildAdminExpiryEmail,
} from './document-expiry-email';
import type { SendEmailParams } from '@/lib/email/send-email';

// Umbrales de alerta (días antes del vencimiento), de más urgente a menos.
export const UMBRALES = [5, 15, 30] as const;

// Umbrales "alcanzados" para un documento a `dias` del vencimiento.
// Vacío si ya venció (dias < 0): los vencidos no disparan en esta fase.
export function umbralesAlcanzados(dias: number): number[] {
  if (dias < 0) return [];
  return UMBRALES.filter((u) => dias <= u);
}

// ── Puerto de datos ───────────────────────────────────────────────────────────

export interface ExpiryDocument {
  id: string;
  user_id: string;
  document_type: string;
  certificado_tipo: string | null;
  certificado_otros_texto: string | null;
  fecha_vencimiento: string; // el store garantiza no-null
}

export interface ExpiryRecipient {
  id: string;
  email: string | null;
  full_name: string | null;
}

export interface SentThreshold {
  document_id: string;
  umbral: number;
  recipient_profile_id: string;
}

export interface ExpiryDataStore {
  // Solo documentos aprobados con fecha_vencimiento no nula.
  getApprovedDatedDocuments(): Promise<ExpiryDocument[]>;
  getAdmins(): Promise<ExpiryRecipient[]>;
  getOwners(ids: string[]): Promise<ExpiryRecipient[]>;
  getSentThresholds(docIds: string[]): Promise<SentThreshold[]>;
  // Registra los umbrales enviados (idempotente: ignora duplicados).
  recordSent(rows: SentThreshold[]): Promise<void>;
}

export type SendEmailFn = (params: SendEmailParams) => Promise<void>;

export interface ExpiryRunResult {
  documentsEvaluated: number;
  sent: number;
  failed: number;
}

export interface RunDeps {
  store: ExpiryDataStore;
  send: SendEmailFn;
  // Fecha de referencia YYYY-MM-DD; por defecto hoy en UTC (como el panel).
  today?: string;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

// ── Orquestación ──────────────────────────────────────────────────────────────

export async function runDocumentExpiryAlerts(
  deps: RunDeps
): Promise<ExpiryRunResult> {
  const { store, send } = deps;
  const today = deps.today ?? new Date().toISOString().split('T')[0];

  const allDocs = await store.getApprovedDatedDocuments();

  // Documentos con al menos un umbral alcanzado (los demás no generan nada).
  const relevant = allDocs
    .map((doc) => {
      const dias = getDiasRestantes(doc.fecha_vencimiento, today);
      return { doc, dias, alcanzados: umbralesAlcanzados(dias) };
    })
    .filter((r) => r.alcanzados.length > 0);

  const result: ExpiryRunResult = {
    documentsEvaluated: relevant.length,
    sent: 0,
    failed: 0,
  };
  if (relevant.length === 0) return result;

  const admins = await store.getAdmins();
  const ownerIds = uniq(relevant.map((r) => r.doc.user_id));
  const owners = await store.getOwners(ownerIds);
  const ownerMap = new Map(owners.map((o) => [o.id, o]));

  const docIds = relevant.map((r) => r.doc.id);
  const sentRows = await store.getSentThresholds(docIds);
  // Mapa `${document_id}|${recipient_profile_id}` -> Set<umbral ya enviado>
  const sentMap = new Map<string, Set<number>>();
  for (const row of sentRows) {
    const key = `${row.document_id}|${row.recipient_profile_id}`;
    const set = sentMap.get(key) ?? new Set<number>();
    set.add(row.umbral);
    sentMap.set(key, set);
  }

  // Envía (si corresponde) a un destinatario y marca DESPUÉS de enviar.
  // Fallo de envío → no registra → se reintenta en la próxima corrida.
  // Fallo aislado → no bloquea a los demás destinatarios.
  async function notify(
    docId: string,
    recipientId: string,
    email: string | null,
    alcanzados: number[],
    build: () => SendEmailParams
  ): Promise<void> {
    const key = `${docId}|${recipientId}`;
    const recorded = sentMap.get(key) ?? new Set<number>();
    const pendientes = alcanzados.filter((u) => !recorded.has(u));
    if (pendientes.length === 0) return; // ya notificado (no dispara tarde)

    if (!email) {
      console.warn(
        `[expiry-alerts] destinatario ${recipientId} sin email para documento ${docId}; se omite el envío.`
      );
      return;
    }

    try {
      await send(build());
    } catch (err) {
      // Fallo de envío: NO se registra, se reintenta la próxima corrida.
      console.error(
        `[expiry-alerts] fallo al enviar alerta a ${recipientId} (documento ${docId}):`,
        err
      );
      result.failed += 1;
      return;
    }

    // Marcar-después-de-enviar: registrar TODOS los umbrales alcanzados
    // (suprime los menos urgentes para que no disparen tarde).
    try {
      await store.recordSent(
        pendientes.map((u) => ({
          document_id: docId,
          umbral: u,
          recipient_profile_id: recipientId,
        }))
      );
    } catch (err) {
      // El email ya salió; loguear visible el fallo de registro (no silencioso).
      console.error(
        `[expiry-alerts] alerta enviada pero falló el registro para ${recipientId} (documento ${docId}):`,
        err
      );
    }
    for (const u of alcanzados) recorded.add(u);
    sentMap.set(key, recorded);
    result.sent += 1;
  }

  for (const { doc, dias, alcanzados } of relevant) {
    const owner = ownerMap.get(doc.user_id) ?? null;
    const tipoLabel = formatDocTypeLabel(
      doc.document_type,
      doc.certificado_tipo,
      doc.certificado_otros_texto
    );

    // 1) Empleado dueño (framing "tu documento").
    await notify(doc.id, doc.user_id, owner?.email ?? null, alcanzados, () =>
      buildEmployeeExpiryEmail({
        to: owner!.email!,
        fullName: owner?.full_name,
        tipoLabel,
        fechaVencimiento: doc.fecha_vencimiento,
        diasRestantes: dias,
      })
    );

    // 2) Cada admin (framing "el documento de [empleado]"), email individual.
    const empleadoName = owner?.full_name || owner?.email || doc.user_id;
    for (const admin of admins) {
      await notify(doc.id, admin.id, admin.email, alcanzados, () =>
        buildAdminExpiryEmail({
          to: admin.email!,
          empleadoName,
          tipoLabel,
          fechaVencimiento: doc.fecha_vencimiento,
          diasRestantes: dias,
        })
      );
    }
  }

  return result;
}
