// Transporte de envío por Gmail API. SOLO para uso server-side.
// Nunca importar desde un componente cliente: usa la JSON key del service
// account (secreto) y hace llamadas autenticadas contra la Gmail API.
//
// Auth: service account con domain-wide delegation, impersonando un buzón real
// de Workspace para enviar como GMAIL_SENDER_ADDRESS. Scope mínimo: gmail.send.
import { JWT } from 'google-auth-library';

// Único scope autorizado en la delegación de todo el dominio (Workspace Admin).
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// `me` resuelve al usuario impersonado por la service account.
const GMAIL_SEND_ENDPOINT =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// Interfaz mínima del transporte: recibe el mensaje RFC 2822 ya codificado en
// base64url y lo envía. Los tests mockean esta interfaz para no tocar la red.
export interface GmailTransport {
  send(rawMessageBase64Url: string): Promise<void>;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function loadServiceAccountKey(): ServiceAccountKey {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) {
    throw new Error('Falta la variable de entorno GOOGLE_SERVICE_ACCOUNT_KEY_B64.');
  }

  // La JSON key se guarda en base64 (una línea) porque la private_key tiene
  // saltos de línea que un .env rompe, y un `#` truncaría el valor.
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_B64 no es un JSON válido en base64.');
  }

  const key = parsed as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) {
    throw new Error('La JSON key del service account no tiene client_email/private_key.');
  }

  return { client_email: key.client_email, private_key: key.private_key };
}

// Crea el transporte real. Fresco por invocación (mismo patrón que
// createAdminClient), nunca un singleton con estado a nivel de módulo.
export function createGmailTransport(): GmailTransport {
  const sender = process.env.GMAIL_SENDER_ADDRESS;
  if (!sender) {
    throw new Error('Falta la variable de entorno GMAIL_SENDER_ADDRESS.');
  }

  // Buzón a impersonar: por defecto el propio sender (si contacto@ es un buzón
  // real). Si difiere, se configura por GMAIL_IMPERSONATED_USER.
  const impersonatedUser = process.env.GMAIL_IMPERSONATED_USER || sender;

  const { client_email, private_key } = loadServiceAccountKey();

  const client = new JWT({
    email: client_email,
    key: private_key,
    scopes: [GMAIL_SEND_SCOPE],
    subject: impersonatedUser,
  });

  return {
    async send(rawMessageBase64Url: string): Promise<void> {
      await client.request({
        url: GMAIL_SEND_ENDPOINT,
        method: 'POST',
        data: { raw: rawMessageBase64Url },
      });
    },
  };
}
