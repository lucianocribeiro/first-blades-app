// Builders de los emails de alerta de vencimiento (dos audiencias separadas).
// Contenido es-AR desde /lib/copy, estilos inline simples con marca First Blades.
// Puros (no envían): reciben datos ya resueltos y devuelven SendEmailParams.
import { copy } from '@/lib/copy';
import { formatDate } from '@/app/(app)/equipo/utils';
import type { SendEmailParams } from '@/lib/email/send-email';

const BRAND_PRIMARY = '#0D7EC7';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Fila etiqueta/valor para la tabla del cuerpo.
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7280;width:180px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-weight:bold;">${escapeHtml(value)}</td>
  </tr>`;
}

// Envoltura común de la tarjeta (mismo lenguaje visual que el email de rechazo).
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

export interface EmployeeExpiryEmailInput {
  to: string;
  fullName?: string | null;
  tipoLabel: string;
  fechaVencimiento: string;
  diasRestantes: number;
}

// Alerta al empleado dueño: "tu documento X vence en N días".
export function buildEmployeeExpiryEmail(
  input: EmployeeExpiryEmailInput
): SendEmailParams {
  const t = copy.emails.vencimientoEmpleado;
  const nombre = input.fullName?.trim();
  const saludo = nombre ? `${t.saludo} ${nombre},` : `${t.saludo},`;
  const fecha = formatDate(input.fechaVencimiento);
  const dias = String(input.diasRestantes);

  const text = [
    saludo,
    '',
    t.intro,
    '',
    `${t.tipoLabel}: ${input.tipoLabel}`,
    `${t.vencimientoLabel}: ${fecha}`,
    `${t.diasLabel}: ${dias}`,
    '',
    t.accion,
    '',
    t.firma,
  ].join('\n');

  const html = card(`
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(saludo)}</p>
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(t.intro)}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:15px;">
      ${row(t.tipoLabel, input.tipoLabel)}
      ${row(t.vencimientoLabel, fecha)}
      ${row(t.diasLabel, dias)}
    </table>
    <p style="margin:0 0 24px;font-size:15px;">${escapeHtml(t.accion)}</p>
    <p style="margin:0;font-size:15px;color:#6b7280;">${escapeHtml(t.firma)}</p>
  `);

  return { to: input.to, subject: t.subject, html, text };
}

export interface AdminExpiryEmailInput {
  to: string;
  empleadoName: string;
  tipoLabel: string;
  fechaVencimiento: string;
  diasRestantes: number;
}

// Alerta a un admin: "el documento X de [empleado] vence en N días".
export function buildAdminExpiryEmail(input: AdminExpiryEmailInput): SendEmailParams {
  const t = copy.emails.vencimientoAdmin;
  const fecha = formatDate(input.fechaVencimiento);
  const dias = String(input.diasRestantes);

  const text = [
    t.intro,
    '',
    `${t.empleadoLabel}: ${input.empleadoName}`,
    `${t.tipoLabel}: ${input.tipoLabel}`,
    `${t.vencimientoLabel}: ${fecha}`,
    `${t.diasLabel}: ${dias}`,
    '',
    t.firma,
  ].join('\n');

  const html = card(`
    <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(t.intro)}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:15px;">
      ${row(t.empleadoLabel, input.empleadoName)}
      ${row(t.tipoLabel, input.tipoLabel)}
      ${row(t.vencimientoLabel, fecha)}
      ${row(t.diasLabel, dias)}
    </table>
    <p style="margin:0;font-size:15px;color:#6b7280;">${escapeHtml(t.firma)}</p>
  `);

  return { to: input.to, subject: t.subject, html, text };
}
