// Emails de resolución de solicitud de ausencia — FB-F3-19, generalizado a
// cualquier motivo en FB-F4-06 (antes hardcodeado a "día de trámite").
// Arma el contenido en es-AR desde /lib/copy y lo envía con `sendEmail`.
// SOLO para uso server-side. Mismo patrón que lib/email/rejection-email.ts.
import { copy } from '@/lib/copy';
import { sendEmail, type SendEmailParams } from './send-email';
import type { GmailTransport } from './gmail-transport';
import type { MotivoAusencia } from '@/lib/db-types';
import { formatRangoAusencia, motivoAusenciaLabel } from '@/lib/rotation/ausencia-display';

// Color primario de marca (design-system). Email simple, estilos inline.
const BRAND_PRIMARY = '#0D7EC7';

// Escapa texto dinámico (nombre, motivo) antes de interpolarlo en el HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AusenciaApprovalEmailInput {
  to: string;
  fullName?: string | null;
  fechaInicio: string;
  fechaFin: string;
  motivoAusencia: MotivoAusencia;
  motivoOtrosTexto?: string | null;
}

export function buildAusenciaApprovalEmail(
  input: AusenciaApprovalEmailInput
): SendEmailParams {
  const t = copy.emails.ausenciaAprobada;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const periodo = formatRangoAusencia(input.fechaInicio, input.fechaFin);
  const motivo = motivoAusenciaLabel(input.motivoAusencia, input.motivoOtrosTexto);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.motivoLabel}: ${motivo}`,
    `${t.periodoLabel}: ${periodo}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.motivoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(motivo)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.periodoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(periodo)}</td>
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

export async function sendAusenciaApprovalEmail(
  input: AusenciaApprovalEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildAusenciaApprovalEmail(input), transport);
}

export interface AusenciaRejectionEmailInput {
  to: string;
  fullName?: string | null;
  fechaInicio: string;
  fechaFin: string;
  motivoAusencia: MotivoAusencia;
  motivoOtrosTexto?: string | null;
  // Texto libre que el admin escribe al rechazar — distinto de motivoAusencia
  // (el motivo de la ausencia en sí, ej. 'vacaciones').
  motivoRechazo: string;
}

export function buildAusenciaRejectionEmail(
  input: AusenciaRejectionEmailInput
): SendEmailParams {
  const t = copy.emails.ausenciaRechazada;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const periodo = formatRangoAusencia(input.fechaInicio, input.fechaFin);
  const motivo = motivoAusenciaLabel(input.motivoAusencia, input.motivoOtrosTexto);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.motivoLabel}: ${motivo}`,
    `${t.periodoLabel}: ${periodo}`,
    `${t.motivoRechazoLabel}: ${input.motivoRechazo}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.motivoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(motivo)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.periodoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(periodo)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">${escapeHtml(t.motivoRechazoLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(input.motivoRechazo)}</td>
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

export async function sendAusenciaRejectionEmail(
  input: AusenciaRejectionEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildAusenciaRejectionEmail(input), transport);
}
