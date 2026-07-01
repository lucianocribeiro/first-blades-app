// Email de rechazo de documento (primer consumidor de lib/email).
// Arma el contenido en es-AR desde /lib/copy y lo envía con `sendEmail`.
// SOLO para uso server-side.
import { copy } from '@/lib/copy';
import { sendEmail, type SendEmailParams } from './send-email';
import type { GmailTransport } from './gmail-transport';

// Color primario de marca (design-system). Email simple, estilos inline.
const BRAND_PRIMARY = '#0D7EC7';

export interface DocumentRejectionEmailInput {
  to: string;
  fullName?: string | null;
  documentType: string;
  motivo: string;
}

// Etiqueta legible del tipo de documento; cae al valor crudo si no hay copy.
function documentTypeLabel(documentType: string): string {
  const tipos = copy.documentos.tipos as Record<string, string>;
  return tipos[documentType] ?? documentType;
}

// Escapa texto dinámico (motivo, nombre) antes de interpolarlo en el HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildDocumentRejectionEmail(
  input: DocumentRejectionEmailInput
): SendEmailParams {
  const t = copy.emails.documentoRechazado;
  const tipo = documentTypeLabel(input.documentType);
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.tipoLabel}: ${tipo}`,
    `${t.motivoLabel}: ${input.motivo}`,
    '',
    t.accion,
    '',
    t.firma,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background-color:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <h1 style="margin:0 0 16px;font-size:18px;color:${BRAND_PRIMARY};">First Blades</h1>
        <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(saludo)}</p>
        <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(t.intro)}</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:15px;">
          <tr>
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.tipoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(tipo)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">${escapeHtml(t.motivoLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(input.motivo)}</td>
          </tr>
        </table>
        <p style="margin:0 0 24px;font-size:15px;">${escapeHtml(t.accion)}</p>
        <p style="margin:0;font-size:15px;color:#6b7280;">${escapeHtml(t.firma)}</p>
      </div>
    </div>
  </body>
</html>`;

  return { to: input.to, subject: t.subject, html, text };
}

// Construye y envía el email de rechazo. Transporte inyectable para tests.
export async function sendDocumentRejectionEmail(
  input: DocumentRejectionEmailInput,
  transport?: GmailTransport
): Promise<void> {
  const email = buildDocumentRejectionEmail(input);
  await sendEmail(email, transport);
}
