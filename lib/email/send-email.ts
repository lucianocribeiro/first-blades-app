// Núcleo de envío de email. SOLO para uso server-side (usa el transporte de
// Gmail, que carga secretos del service account).
//
// Reutilizable: cualquier consumidor (rechazo de documentos, y en FB-F2-07 las
// alertas de vencimiento) usa el mismo `sendEmail` sin reescribirlo.
import { createGmailTransport, type GmailTransport } from './gmail-transport';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// base64url = base64 con -/_ y sin padding. Formato que espera la Gmail API.
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Codifica un header con caracteres no ASCII (es-AR: acentos, ñ) en
// "encoded-word" MIME (=?UTF-8?B?...?=). Si es ASCII puro, lo deja tal cual.
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

// Construye el mensaje RFC 2822 como multipart/alternative (texto + HTML) y lo
// devuelve codificado en base64url, listo para users.messages.send.
export function buildRawMessage(params: SendEmailParams & { from: string }): string {
  const { from, to, subject, html, text } = params;

  // Boundary estable pero único por mensaje.
  const boundary = `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    `--${boundary}--`,
  ];

  // RFC 2822 usa CRLF como separador de líneas.
  const message = [...headers, '', ...body].join('\r\n');
  return toBase64Url(message);
}

// Envía un email vía Gmail API. El transporte es inyectable para tests; por
// defecto usa el transporte real (Gmail + service account).
export async function sendEmail(
  params: SendEmailParams,
  transport?: GmailTransport
): Promise<void> {
  const from = process.env.GMAIL_SENDER_ADDRESS;
  if (!from) {
    throw new Error('Falta la variable de entorno GMAIL_SENDER_ADDRESS.');
  }

  const raw = buildRawMessage({ ...params, from });
  const gmail = transport ?? createGmailTransport();
  await gmail.send(raw);
}
