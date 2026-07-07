// Builder del email de alerta de descanso (FB-F3-13). Contenido es-AR desde
// /lib/copy, mismo lenguaje visual que los demás emails de notificación.
// Terminología amigable (FB-F3-12): reutiliza copy.calendario.alertasFranco
// ("días sin descanso" / "días de franco prolongado") — nada de "racha" ni
// "umbral" en el texto. Solo a admins (el in-app ya cubre a supervisores).
// Puro (no envía): recibe datos ya resueltos y devuelve SendEmailParams.
import { copy } from '@/lib/copy';
import type { SendEmailParams } from '@/lib/email/send-email';
import type { FrancoAlertTipo } from '@/app/(app)/calendario/francoAlerts';

const BRAND_PRIMARY = '#0D7EC7';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7280;width:180px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-weight:bold;">${escapeHtml(value)}</td>
  </tr>`;
}

function card(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background-color:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <h1 style="margin:0 0 16px;font-size:18px;color:${BRAND_PRIMARY};">First Blades</h1>
        ${innerHtml}
      </div>
    </div>
  </body>
</html>`;
}

// "52 días sin descanso" / "18 días de franco prolongado" — mismo armado que
// el pill del panel in-app (FrancoAlertPanel), en texto plano.
function alertaLabel(tipo: FrancoAlertTipo, valor: number): string {
  return `${valor} ${copy.calendario.alertasFranco.tipos[tipo]}`;
}

export interface FrancoAlertEmailInput {
  to: string;
  empleadoName: string;
  tipo: FrancoAlertTipo;
  valor: number;
}

export function buildFrancoAlertEmail(input: FrancoAlertEmailInput): SendEmailParams {
  const t = copy.emails.alertaFranco;
  const alerta = alertaLabel(input.tipo, input.valor);

  const text = [
    t.intro,
    '',
    `${t.empleadoLabel}: ${input.empleadoName}`,
    `${t.alertaLabel}: ${alerta}`,
    '',
    t.accion,
    '',
    t.firma,
  ].join('\n');

  const html = card(`
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(t.intro)}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:15px;">
      ${row(t.empleadoLabel, input.empleadoName)}
      ${row(t.alertaLabel, alerta)}
    </table>
    <p style="margin:0 0 24px;font-size:15px;">${escapeHtml(t.accion)}</p>
    <p style="margin:0;font-size:15px;color:#6b7280;">${escapeHtml(t.firma)}</p>
  `);

  return { to: input.to, subject: t.subject, html, text };
}
