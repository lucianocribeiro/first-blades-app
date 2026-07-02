/**
 * FB-F2-07 — Alertas de vencimiento de documentos (cron + log de idempotencia).
 *
 * Toda la lógica (umbrales / idempotencia / destinatarios) se testea con un
 * ExpiryDataStore en memoria y un `send` mockeado: ningún test toca red ni BD.
 * La implementación Supabase del store se cubre en tests/integration.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

import {
  runDocumentExpiryAlerts,
  umbralesAlcanzados,
  UMBRALES,
  type ExpiryDataStore,
  type ExpiryDocument,
  type ExpiryRecipient,
  type SentThreshold,
} from '@/lib/notifications/document-expiry';
import {
  buildEmployeeExpiryEmail,
  buildAdminExpiryEmail,
} from '@/lib/notifications/document-expiry-email';
import { copy } from '@/lib/copy';

const TODAY = '2026-07-01';

// Helpers de fechas relativas a TODAY (UTC-midnight, como el panel Equipo).
function fechaEnDias(dias: number): string {
  const [y, m, d] = TODAY.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + dias * 86_400_000;
  return new Date(ms).toISOString().split('T')[0];
}

function doc(overrides: Partial<ExpiryDocument> & { id: string; dias: number }): ExpiryDocument {
  return {
    id: overrides.id,
    user_id: overrides.user_id ?? 'owner-1',
    document_type: overrides.document_type ?? 'licencia',
    certificado_tipo: overrides.certificado_tipo ?? null,
    certificado_otros_texto: overrides.certificado_otros_texto ?? null,
    fecha_vencimiento: fechaEnDias(overrides.dias),
  };
}

interface StoreState {
  docs: ExpiryDocument[];
  admins: ExpiryRecipient[];
  owners: ExpiryRecipient[];
  recorded: SentThreshold[];
  recordShouldThrow?: boolean;
}

function makeStore(state: Partial<StoreState>): { store: ExpiryDataStore; state: StoreState } {
  const s: StoreState = {
    docs: state.docs ?? [],
    admins: state.admins ?? [],
    owners: state.owners ?? [],
    recorded: state.recorded ? [...state.recorded] : [],
    recordShouldThrow: state.recordShouldThrow,
  };
  const store: ExpiryDataStore = {
    async getApprovedDatedDocuments() {
      return s.docs;
    },
    async getAdmins() {
      return s.admins;
    },
    async getOwners(ids) {
      return s.owners.filter((o) => ids.includes(o.id));
    },
    async getSentThresholds(docIds) {
      return s.recorded.filter((r) => docIds.includes(r.document_id));
    },
    async recordSent(rows) {
      if (s.recordShouldThrow) throw new Error('record fail');
      s.recorded.push(...rows);
    },
  };
  return { store, state: s };
}

const owner = (id = 'owner-1', email: string | null = 'owner@test.com'): ExpiryRecipient => ({
  id,
  email,
  full_name: 'Empleado Uno',
});
const admin = (id: string, email: string | null): ExpiryRecipient => ({
  id,
  email,
  full_name: `Admin ${id}`,
});

describe('umbralesAlcanzados', () => {
  it('devuelve todos los umbrales >= dias, más urgente primero', () => {
    expect(umbralesAlcanzados(4)).toEqual([5, 15, 30]);
    expect(umbralesAlcanzados(12)).toEqual([15, 30]);
    expect(umbralesAlcanzados(27)).toEqual([30]);
  });
  it('límites exactos incluidos', () => {
    expect(umbralesAlcanzados(5)).toEqual([5, 15, 30]);
    expect(umbralesAlcanzados(15)).toEqual([15, 30]);
    expect(umbralesAlcanzados(30)).toEqual([30]);
  });
  it('fuera de ventana o ya vencido: vacío', () => {
    expect(umbralesAlcanzados(31)).toEqual([]);
    expect(umbralesAlcanzados(0)).toEqual([5, 15, 30]); // hoy vence: aún alerta
    expect(umbralesAlcanzados(-1)).toEqual([]);
    expect(umbralesAlcanzados(-10)).toEqual([]);
  });
  it('UMBRALES son 5/15/30', () => {
    expect([...UMBRALES]).toEqual([5, 15, 30]);
  });
});

describe('runDocumentExpiryAlerts: umbrales y envío', () => {
  let send: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    send = vi.fn().mockResolvedValue(undefined);
  });

  it('envía un solo email (el umbral más urgente alcanzado) y registra TODA la R', async () => {
    const { store, state } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner()],
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });

    expect(res).toEqual({ documentsEvaluated: 1, sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    // Registra los 3 umbrales alcanzados para el dueño (suprime los menos urgentes).
    const umbrales = state.recorded
      .filter((r) => r.recipient_profile_id === 'owner-1')
      .map((r) => r.umbral)
      .sort((a, b) => a - b);
    expect(umbrales).toEqual([5, 15, 30]);
  });

  it('solo aprobados con vencimiento; vencidos (dias<0) y fuera de ventana no disparan', async () => {
    const { store } = makeStore({
      docs: [
        doc({ id: 'venc', dias: -2 }),
        doc({ id: 'lejos', dias: 31 }),
        doc({ id: 'cerca', dias: 4 }),
      ],
      owners: [owner()],
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res.documentsEvaluated).toBe(1); // solo 'cerca'
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('runDocumentExpiryAlerts: idempotencia y no-disparo-tardío', () => {
  it('correr dos veces el mismo día no reenvía a ningún destinatario', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { store } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner()],
      admins: [admin('a1', 'a1@test.com')],
    });

    const r1 = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(r1.sent).toBe(2); // dueño + 1 admin
    send.mockClear();

    const r2 = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(r2.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('catch-up: documento que entra a la ventana ya adentro recibe UN email', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    // dias=12 => R=[15,30]; nunca se envió el de 30 (cron arrancó tarde).
    const { store, state } = makeStore({
      docs: [doc({ id: 'd1', dias: 12 })],
      owners: [owner()],
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const umbrales = state.recorded.map((r) => r.umbral).sort((a, b) => a - b);
    expect(umbrales).toEqual([15, 30]); // registra ambos
  });

  it('progresión 30→15→5: un email por umbral cruzado, sin repetir los previos', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    // Estado inicial: ya se envió/registró el umbral 30 y 15.
    const { store } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })], // R=[5,15,30]
      owners: [owner()],
      recorded: [
        { document_id: 'd1', umbral: 30, recipient_profile_id: 'owner-1' },
        { document_id: 'd1', umbral: 15, recipient_profile_id: 'owner-1' },
      ],
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res.sent).toBe(1); // solo el nuevo umbral 5
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('una vez enviado un umbral, los menos urgentes no disparan en corridas siguientes', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { store } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner()],
    });
    await runDocumentExpiryAlerts({ store, send, today: TODAY }); // registra [5,15,30]
    send.mockClear();
    // Al día siguiente (dias=3), R sigue [5,15,30] pero todos registrados.
    const res = await runDocumentExpiryAlerts({ store, send, today: fechaEnDias(1) });
    expect(res.sent).toBe(0);
  });
});

describe('runDocumentExpiryAlerts: marcar-después-de-enviar y fallos', () => {
  it('fallo de envío NO registra el log → se reintenta la próxima corrida', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockRejectedValueOnce(new Error('gmail caído'));
    const { store, state } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner()],
    });
    const r1 = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(r1).toEqual({ documentsEvaluated: 1, sent: 0, failed: 1 });
    expect(state.recorded).toHaveLength(0); // no registró nada
    expect(errorSpy).toHaveBeenCalled();

    // Próxima corrida: el envío ahora funciona → reintenta y envía.
    send.mockResolvedValue(undefined);
    const r2 = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(r2.sent).toBe(1);
    errorSpy.mockRestore();
  });

  it('fallo parcial: el fallo a un destinatario no bloquea a los demás', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Falla solo el envío al dueño; el admin sí recibe.
    const send = vi.fn().mockImplementation((p: { to: string }) => {
      if (p.to === 'owner@test.com') return Promise.reject(new Error('fallo dueño'));
      return Promise.resolve();
    });
    const { store, state } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner()],
      admins: [admin('a1', 'a1@test.com')],
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res).toEqual({ documentsEvaluated: 1, sent: 1, failed: 1 });
    // Registró solo al admin, no al dueño (que falló).
    const recipients = state.recorded.map((r) => r.recipient_profile_id);
    expect(recipients).toContain('a1');
    expect(recipients).not.toContain('owner-1');
    errorSpy.mockRestore();
  });

  it('email nulo del destinatario: se omite con log, sin crash ni envío', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(undefined);
    const { store, state } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner('owner-1', null)], // sin email
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(state.recorded).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('email enviado pero registro falla: cuenta como enviado y loguea (no silencioso)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(undefined);
    const { store } = makeStore({
      docs: [doc({ id: 'd1', dias: 4 })],
      owners: [owner()],
      recordShouldThrow: true,
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res.sent).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('runDocumentExpiryAlerts: destinatarios separados por audiencia', () => {
  it('dueño y admins reciben emails distintos; nunca se mezclan en el mismo To', async () => {
    const sent: Array<{ to: string; subject: string }> = [];
    const send = vi.fn().mockImplementation((p: { to: string; subject: string }) => {
      sent.push({ to: p.to, subject: p.subject });
      return Promise.resolve();
    });
    const { store } = makeStore({
      docs: [doc({ id: 'd1', dias: 4, user_id: 'owner-1' })],
      owners: [owner()],
      admins: [admin('a1', 'a1@test.com'), admin('a2', 'a2@test.com')],
    });
    const res = await runDocumentExpiryAlerts({ store, send, today: TODAY });
    expect(res.sent).toBe(3); // dueño + 2 admins, individuales

    const empleadoMail = sent.find((m) => m.to === 'owner@test.com');
    const adminMails = sent.filter((m) => m.to !== 'owner@test.com');
    expect(empleadoMail?.subject).toBe(copy.emails.vencimientoEmpleado.subject);
    expect(adminMails).toHaveLength(2);
    expect(adminMails.every((m) => m.subject === copy.emails.vencimientoAdmin.subject)).toBe(true);
    // Cada envío es a un único destinatario (nunca dueño + admin juntos).
    expect(sent.map((m) => m.to).sort()).toEqual(
      ['a1@test.com', 'a2@test.com', 'owner@test.com'].sort()
    );
  });
});

describe('builders de email (es-AR)', () => {
  it('empleado: incluye tipo, fecha formateada, días y CTA a Mi Perfil', () => {
    const email = buildEmployeeExpiryEmail({
      to: 'owner@test.com',
      fullName: 'Juan Pérez',
      tipoLabel: 'Licencia de conducir',
      fechaVencimiento: '2026-07-20',
      diasRestantes: 5,
    });
    expect(email.subject).toBe(copy.emails.vencimientoEmpleado.subject);
    expect(email.text).toContain('Juan Pérez');
    expect(email.text).toContain('Licencia de conducir');
    expect(email.text).toContain('20/07/2026');
    expect(email.text).toContain('5');
    expect(email.text).toContain(copy.emails.vencimientoEmpleado.accion);
  });

  it('admin: incluye el nombre del empleado y el framing de admin', () => {
    const email = buildAdminExpiryEmail({
      to: 'admin@test.com',
      empleadoName: 'Juan Pérez',
      tipoLabel: 'DNI',
      fechaVencimiento: '2026-07-20',
      diasRestantes: 15,
    });
    expect(email.subject).toBe(copy.emails.vencimientoAdmin.subject);
    expect(email.text).toContain('Juan Pérez');
    expect(email.text).toContain('DNI');
    expect(email.text).toContain('15');
  });

  it('escapa HTML en valores dinámicos', () => {
    const email = buildAdminExpiryEmail({
      to: 'admin@test.com',
      empleadoName: '<b>hack</b>',
      tipoLabel: 'DNI',
      fechaVencimiento: '2026-07-20',
      diasRestantes: 5,
    });
    expect(email.html).not.toContain('<b>hack</b>');
    expect(email.html).toContain('&lt;b&gt;');
  });
});
