// Emails de resolución de solicitud de pasaje — FB-F4-10, mismo molde que
// lib/email/ausencia-resolution-email.ts. Arma el contenido en es-AR desde
// /lib/copy y lo envía con `sendEmail`. SOLO para uso server-side.
import { copy } from '@/lib/copy';
import { sendEmail, type SendEmailParams } from './send-email';
import type { GmailTransport } from './gmail-transport';
import type { MotivoViaje } from '@/lib/db-types';
import { formatDiasViaje, motivoViajeLabel } from '@/lib/rotation/pasaje-display';

// Color primario de marca (design-system). Email simple, estilos inline.
const BRAND_PRIMARY = '#0D7EC7';

// Escapa texto dinámico (nombre, origen/destino) antes de interpolarlo en el HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type PasajeEmailBase = {
  to: string;
  fullName?: string | null;
  motivoViaje: MotivoViaje;
  origen: string;
  destino: string;
  diasViaje: string[];
};

export type PasajeApprovalEmailInput = PasajeEmailBase;

export function buildPasajeApprovalEmail(input: PasajeApprovalEmailInput): SendEmailParams {
  const t = copy.emails.pasajeAprobado;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const recorrido = `${input.origen} → ${input.destino}`;
  const motivo = motivoViajeLabel(input.motivoViaje);
  const dias = formatDiasViaje(input.diasViaje);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.motivoLabel}: ${motivo}`,
    `${t.recorridoLabel}: ${recorrido}`,
    `${t.diasLabel}: ${dias}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.recorridoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(recorrido)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">${escapeHtml(t.diasLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(dias)}</td>
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

export async function sendPasajeApprovalEmail(
  input: PasajeApprovalEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildPasajeApprovalEmail(input), transport);
}

export type PasajeRejectionEmailInput = PasajeEmailBase & {
  // Texto libre que el admin escribe al rechazar — distinto de motivoViaje
  // (el motivo del viaje en sí, ej. 'traslado_proyectos').
  motivoRechazo: string;
};

export function buildPasajeRejectionEmail(input: PasajeRejectionEmailInput): SendEmailParams {
  const t = copy.emails.pasajeRechazado;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const recorrido = `${input.origen} → ${input.destino}`;
  const motivo = motivoViajeLabel(input.motivoViaje);
  const dias = formatDiasViaje(input.diasViaje);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.motivoLabel}: ${motivo}`,
    `${t.recorridoLabel}: ${recorrido}`,
    `${t.diasLabel}: ${dias}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.recorridoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(recorrido)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">${escapeHtml(t.diasLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(dias)}</td>
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

export async function sendPasajeRejectionEmail(
  input: PasajeRejectionEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildPasajeRejectionEmail(input), transport);
}
