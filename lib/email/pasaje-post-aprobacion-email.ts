// Emails de cambio post-aprobación de un pasaje (FB-F4-14): cancelación o
// edición de días sobre una solicitud ya aprobada. Mismo molde que
// lib/email/pasaje-resolution-email.ts (aprobar/rechazar) y su análogo de
// ausencia (ausencia-post-aprobacion-email.ts). Se notifica al EMPLEADO
// (quien viaja), no necesariamente a quien solicitó — mismo criterio que el
// resto de las notificaciones de pasaje. SOLO para uso server-side.
import { copy } from '@/lib/copy';
import { sendEmail, type SendEmailParams } from './send-email';
import type { GmailTransport } from './gmail-transport';
import type { MotivoViaje } from '@/lib/db-types';
import { formatDiasViaje, motivoViajeLabel } from '@/lib/rotation/pasaje-display';

const BRAND_PRIMARY = '#0D7EC7';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PasajeCanceladoEmailInput {
  to: string;
  fullName?: string | null;
  motivoViaje: MotivoViaje;
  origen: string;
  destino: string;
  diasViaje: string[];
  comentario: string;
}

export function buildPasajeCanceladoEmail(input: PasajeCanceladoEmailInput): SendEmailParams {
  const t = copy.emails.pasajeCancelado;
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
    `${t.comentarioLabel}: ${input.comentario}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.diasLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(dias)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">${escapeHtml(t.comentarioLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(input.comentario)}</td>
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

export async function sendPasajeCanceladoEmail(
  input: PasajeCanceladoEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildPasajeCanceladoEmail(input), transport);
}

export interface PasajeEditadoEmailInput {
  to: string;
  fullName?: string | null;
  motivoViaje: MotivoViaje;
  origen: string;
  destino: string;
  diasViajeAnteriores: string[];
  diasViajeNuevos: string[];
  comentario: string;
}

export function buildPasajeEditadoEmail(input: PasajeEditadoEmailInput): SendEmailParams {
  const t = copy.emails.pasajeEditado;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const recorrido = `${input.origen} → ${input.destino}`;
  const motivo = motivoViajeLabel(input.motivoViaje);
  const diasAnteriores = formatDiasViaje(input.diasViajeAnteriores);
  const diasNuevos = formatDiasViaje(input.diasViajeNuevos);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.motivoLabel}: ${motivo}`,
    `${t.recorridoLabel}: ${recorrido}`,
    `${t.diasAnterioresLabel}: ${diasAnteriores}`,
    `${t.diasNuevosLabel}: ${diasNuevos}`,
    `${t.comentarioLabel}: ${input.comentario}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.diasAnterioresLabel)}</td>
            <td style="padding:6px 0;text-decoration:line-through;color:#6b7280;">${escapeHtml(diasAnteriores)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.diasNuevosLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(diasNuevos)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;vertical-align:top;">${escapeHtml(t.comentarioLabel)}</td>
            <td style="padding:6px 0;">${escapeHtml(input.comentario)}</td>
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

export async function sendPasajeEditadoEmail(
  input: PasajeEditadoEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildPasajeEditadoEmail(input), transport);
}
