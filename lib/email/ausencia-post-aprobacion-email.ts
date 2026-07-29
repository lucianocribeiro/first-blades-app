// Emails de cambio post-aprobación de una ausencia (FB-F4-14): cancelación o
// edición de fechas sobre una solicitud ya aprobada. Mismo molde que
// lib/email/ausencia-resolution-email.ts (aprobar/rechazar), pero estos dos
// SIEMPRE incluyen el comentario obligatorio del admin — es el "por qué" que
// el empleado necesita para entender el cambio. SOLO para uso server-side.
import { copy } from '@/lib/copy';
import { sendEmail, type SendEmailParams } from './send-email';
import type { GmailTransport } from './gmail-transport';
import type { MotivoAusencia } from '@/lib/db-types';
import { formatRangoAusencia, motivoAusenciaLabel } from '@/lib/rotation/ausencia-display';

const BRAND_PRIMARY = '#0D7EC7';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AusenciaCanceladaEmailInput {
  to: string;
  fullName?: string | null;
  fechaInicio: string;
  fechaFin: string;
  motivoAusencia: MotivoAusencia;
  motivoOtrosTexto?: string | null;
  comentario: string;
}

export function buildAusenciaCanceladaEmail(input: AusenciaCanceladaEmailInput): SendEmailParams {
  const t = copy.emails.ausenciaCancelada;
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.periodoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(periodo)}</td>
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

export async function sendAusenciaCanceladaEmail(
  input: AusenciaCanceladaEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildAusenciaCanceladaEmail(input), transport);
}

export interface AusenciaEditadaEmailInput {
  to: string;
  fullName?: string | null;
  fechaInicioAnterior: string;
  fechaFinAnterior: string;
  fechaInicioNueva: string;
  fechaFinNueva: string;
  motivoAusencia: MotivoAusencia;
  motivoOtrosTexto?: string | null;
  comentario: string;
}

export function buildAusenciaEditadaEmail(input: AusenciaEditadaEmailInput): SendEmailParams {
  const t = copy.emails.ausenciaEditada;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const periodoAnterior = formatRangoAusencia(input.fechaInicioAnterior, input.fechaFinAnterior);
  const periodoNuevo = formatRangoAusencia(input.fechaInicioNueva, input.fechaFinNueva);
  const motivo = motivoAusenciaLabel(input.motivoAusencia, input.motivoOtrosTexto);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.motivoLabel}: ${motivo}`,
    `${t.periodoAnteriorLabel}: ${periodoAnterior}`,
    `${t.periodoNuevoLabel}: ${periodoNuevo}`,
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
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.periodoAnteriorLabel)}</td>
            <td style="padding:6px 0;text-decoration:line-through;color:#6b7280;">${escapeHtml(periodoAnterior)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;width:180px;">${escapeHtml(t.periodoNuevoLabel)}</td>
            <td style="padding:6px 0;font-weight:bold;">${escapeHtml(periodoNuevo)}</td>
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

export async function sendAusenciaEditadaEmail(
  input: AusenciaEditadaEmailInput,
  transport?: GmailTransport
): Promise<void> {
  await sendEmail(buildAusenciaEditadaEmail(input), transport);
}
