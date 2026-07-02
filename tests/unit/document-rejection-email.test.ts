/**
 * FB-F2-06 — Infra de email (Gmail API) + email de rechazo de documentos.
 *
 * Cubre, con el transporte de Gmail SIEMPRE mockeado (ningún test toca la red):
 *  - Construcción del mensaje RFC 2822 + base64url (From/To/Subject/cuerpo).
 *  - Encoding de Subject con caracteres es-AR (encoded-word MIME).
 *  - Builder del email de rechazo (tipo de documento + motivo, copy es-AR).
 *  - sendEmail con transporte inyectado (no envía correo real).
 *  - Hook en rejectDocument: destinatario desde profiles.email, motivo correcto,
 *    caso email nulo (skip logueado, sin crash), fallo no bloqueante.
 *  - Límite de rol (admin / supervisor / empleado) sobre el server action.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks de módulos server-only ANTES de importar el código bajo prueba ──────
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/email/rejection-email', () => ({
  sendDocumentRejectionEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendDocumentRejectionEmail } from '@/lib/email/rejection-email';
import { rejectDocument } from '@/app/(app)/aprobaciones/actions';
import { buildRawMessage, sendEmail } from '@/lib/email/send-email';
import type { GmailTransport } from '@/lib/email/gmail-transport';
import { copy } from '@/lib/copy';

// Los mocks de arriba reemplazan el módulo entero; para los tests puros del
// builder necesitamos la implementación real, que importamos sin pasar por el
// mock via import dinámico del archivo original.
const realRejection = await vi.importActual<
  typeof import('@/lib/email/rejection-email')
>('@/lib/email/rejection-email');

// ── Helper: decodifica un mensaje base64url a texto ───────────────────────────
function decodeBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('buildRawMessage: RFC 2822 + base64url', () => {
  it('codifica un mensaje decodificable con headers From/To/Subject', () => {
    const raw = buildRawMessage({
      from: 'contacto@first-blades.com',
      to: 'empleado@test.com',
      subject: 'Asunto simple',
      html: '<p>hola</p>',
      text: 'hola',
    });

    // base64url no debe contener +, / ni =
    expect(raw).not.toMatch(/[+/=]/);

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('From: contacto@first-blades.com');
    expect(decoded).toContain('To: empleado@test.com');
    expect(decoded).toContain('Subject: Asunto simple');
    expect(decoded).toContain('MIME-Version: 1.0');
    expect(decoded).toContain('multipart/alternative; boundary=');
    expect(decoded).toContain('text/plain; charset="UTF-8"');
    expect(decoded).toContain('text/html; charset="UTF-8"');
    // Usa CRLF como separador de líneas (RFC 2822)
    expect(decoded).toContain('\r\n');
  });

  it('codifica el Subject no-ASCII (es-AR) como encoded-word MIME', () => {
    const raw = buildRawMessage({
      from: 'contacto@first-blades.com',
      to: 'empleado@test.com',
      subject: 'Rechazámos tu documento — acción requerida',
      html: '<p>x</p>',
      text: 'x',
    });
    const decoded = decodeBase64Url(raw);
    // El header queda como =?UTF-8?B?...?= y no en crudo con acentos
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(decoded).not.toContain('Subject: Rechazámos');
  });

  it('incluye el cuerpo html y texto (codificados base64) en el multipart', () => {
    const raw = buildRawMessage({
      from: 'contacto@first-blades.com',
      to: 'empleado@test.com',
      subject: 'x',
      html: '<p>contenido-html</p>',
      text: 'contenido-texto',
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain(Buffer.from('<p>contenido-html</p>', 'utf8').toString('base64'));
    expect(decoded).toContain(Buffer.from('contenido-texto', 'utf8').toString('base64'));
  });
});

describe('buildDocumentRejectionEmail: contenido es-AR', () => {
  it('arma subject/text/html con tipo de documento y motivo', () => {
    const email = realRejection.buildDocumentRejectionEmail({
      to: 'empleado@test.com',
      fullName: 'Juan Pérez',
      documentType: 'licencia',
      motivo: 'La foto está borrosa.',
    });

    expect(email.to).toBe('empleado@test.com');
    expect(email.subject).toBe(copy.emails.documentoRechazado.subject);
    // Etiqueta legible del tipo (desde copy.documentos.tipos)
    expect(email.text).toContain('Licencia de conducir');
    expect(email.html).toContain('Licencia de conducir');
    // Motivo presente en ambas partes
    expect(email.text).toContain('La foto está borrosa.');
    expect(email.html).toContain('La foto está borrosa.');
    // Saludo con nombre y llamada a corregir/reenviar
    expect(email.text).toContain('Juan Pérez');
    expect(email.text).toContain(copy.emails.documentoRechazado.accion);
  });

  it('cae al valor crudo si el tipo no tiene etiqueta en copy', () => {
    const email = realRejection.buildDocumentRejectionEmail({
      to: 'x@test.com',
      documentType: 'tipo_desconocido',
      motivo: 'motivo',
    });
    expect(email.text).toContain('tipo_desconocido');
  });

  it('escapa HTML en el motivo para evitar inyección en el cuerpo', () => {
    const email = realRejection.buildDocumentRejectionEmail({
      to: 'x@test.com',
      documentType: 'dni',
      motivo: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('sendEmail: transporte inyectado (sin red)', () => {
  const OLD_ENV = process.env.GMAIL_SENDER_ADDRESS;

  beforeEach(() => {
    process.env.GMAIL_SENDER_ADDRESS = 'contacto@first-blades.com';
  });
  afterEach(() => {
    process.env.GMAIL_SENDER_ADDRESS = OLD_ENV;
  });

  it('envía el mensaje base64url por el transporte inyectado', async () => {
    const transport: GmailTransport = { send: vi.fn().mockResolvedValue(undefined) };
    await sendEmail(
      { to: 'e@test.com', subject: 'Hola', html: '<p>h</p>', text: 'h' },
      transport
    );
    expect(transport.send).toHaveBeenCalledTimes(1);
    const raw = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(decodeBase64Url(raw)).toContain('To: e@test.com');
  });

  it('lanza si falta GMAIL_SENDER_ADDRESS', async () => {
    delete process.env.GMAIL_SENDER_ADDRESS;
    const transport: GmailTransport = { send: vi.fn() };
    await expect(
      sendEmail({ to: 'e@test.com', subject: 's', html: 'h', text: 't' }, transport)
    ).rejects.toThrow(/GMAIL_SENDER_ADDRESS/);
    expect(transport.send).not.toHaveBeenCalled();
  });
});

// ── Hook en el server action de rechazo ───────────────────────────────────────

interface AdminMockOptions {
  docData?: { user_id: string; document_type: string } | null;
  docError?: unknown;
  ownerData?: { email: string | null; full_name: string | null } | null;
  ownerError?: unknown;
  updateError?: unknown;
}

function makeAdminMock(opts: AdminMockOptions = {}) {
  const {
    docData = { user_id: 'owner-id', document_type: 'dni' },
    docError = null,
    ownerData = { email: 'owner@test.com', full_name: 'Owner Test' },
    ownerError = null,
    updateError = null,
  } = opts;

  return {
    from: vi.fn((table: string) => {
      if (table === 'documents') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: updateError }),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: docData, error: docError }),
            })),
          })),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: ownerData, error: ownerError }),
            })),
          })),
        };
      }
      // audit_log
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }),
  };
}

// Configura createServerClient (usado por requireAdmin) para un rol dado.
function mockCallerRole(role: string, userId = 'admin-id') {
  const profile = {
    id: userId,
    email: `${role}@test.com`,
    full_name: `Test ${role}`,
    role,
    status: 'activo',
    supervisor_id: null,
    phone: null,
    cuit: null,
    winda_id: null,
    dni: null,
    fecha_ingreso: null,
    entrevista_tecnica: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        }),
      }),
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
}

describe('rejectDocument: notificación por email al dueño', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallerRole('admin');
  });

  it('resuelve el destinatario desde profiles.email y envía con el motivo', async () => {
    const adminMock = makeAdminMock({
      docData: { user_id: 'owner-id', document_type: 'licencia' },
      ownerData: { email: 'dueño@test.com', full_name: 'Dueño Real' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createAdminClient).mockReturnValue(adminMock as any);

    await rejectDocument('doc-1', '  Motivo con espacios  ');

    expect(sendDocumentRejectionEmail).toHaveBeenCalledTimes(1);
    expect(sendDocumentRejectionEmail).toHaveBeenCalledWith({
      to: 'dueño@test.com',
      fullName: 'Dueño Real',
      documentType: 'licencia',
      motivo: 'Motivo con espacios', // trim aplicado
    });
  });

  it('caso email nulo: loguea el skip y NO envía, sin crashear', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adminMock = makeAdminMock({
      ownerData: { email: null, full_name: 'Sin Email' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createAdminClient).mockReturnValue(adminMock as any);

    await expect(rejectDocument('doc-1', 'motivo')).resolves.toBeUndefined();
    expect(sendDocumentRejectionEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fallo de envío: no bloqueante (el rechazo se mantiene) y logueado', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendDocumentRejectionEmail).mockRejectedValueOnce(new Error('gmail caído'));
    const adminMock = makeAdminMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createAdminClient).mockReturnValue(adminMock as any);

    await expect(rejectDocument('doc-1', 'motivo')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email]'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('rechaza el motivo vacío antes de tocar nada', async () => {
    await expect(rejectDocument('doc-1', '   ')).rejects.toThrow();
    expect(sendDocumentRejectionEmail).not.toHaveBeenCalled();
  });
});

describe('rejectDocument: límite de rol (admin / supervisor / empleado)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createAdminClient).mockReturnValue(makeAdminMock() as any);
  });

  it('admin: NO redirige a /dashboard (acceso permitido)', async () => {
    mockCallerRole('admin');
    await rejectDocument('doc-1', 'motivo');
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });

  it('supervisor: redirige a /dashboard (bloqueado)', async () => {
    mockCallerRole('supervisor', 'sup-id');
    await rejectDocument('doc-1', 'motivo');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado: redirige a /dashboard (bloqueado)', async () => {
    mockCallerRole('empleado', 'emp-id');
    await rejectDocument('doc-1', 'motivo');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
