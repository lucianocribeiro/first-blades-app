/**
 * FB-F3-13 — Cron de mail de alertas de descanso (a admins).
 *
 * Toda la lógica (destinatarios / idempotencia por episodio / envío) se
 * testea con un FrancoAlertsDataStore en memoria y un `send` mockeado:
 * ningún test toca red ni BD. La detección de quién está en alerta y en
 * qué umbral la sigue haciendo computeFrancoAlerts (francoAlerts.ts, ya
 * testeado en calendario-franco-alertas.test.ts) — acá NO se reimplementa,
 * se ejercita a través de runFrancoAlerts con datos reales de
 * empleados/días. La implementación Supabase del store se cubre en
 * tests/integration.
 */
import { vi, describe, it, expect } from 'vitest';

import {
  runFrancoAlerts,
  type FrancoAlertsDataStore,
  type FrancoAlertRecipient,
  type SentFrancoAlert,
} from '@/lib/notifications/franco-alerts';
import { buildFrancoAlertEmail } from '@/lib/notifications/franco-alerts-email';
import { copy } from '@/lib/copy';
import type { FrancoAlertaDia } from '@/app/(app)/calendario/francoAlerts';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';
import type { EstadoDia } from '@/lib/db-types';

const HOY = '2026-07-31';
const EMP1: RosterEmployee = { id: 'emp-1', full_name: 'Empleado Uno', email: 'emp1@test.com' };

function fechaMenos(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().split('T')[0];
}

function diasConsecutivos(userId: string, fechaFin: string, n: number, estado: EstadoDia): FrancoAlertaDia[] {
  const dias: FrancoAlertaDia[] = [];
  for (let i = n - 1; i >= 0; i--) {
    dias.push({ user_id: userId, fecha: fechaMenos(fechaFin, i), estado_dia: estado, es_estimado: false });
  }
  return dias;
}

const admin = (id: string, email: string | null): FrancoAlertRecipient => ({
  id,
  email,
  full_name: `Admin ${id}`,
});

interface StoreState {
  employees: RosterEmployee[];
  dias: FrancoAlertaDia[];
  admins: FrancoAlertRecipient[];
  recorded: SentFrancoAlert[];
  recordShouldThrow?: boolean;
}

function makeStore(state: Partial<StoreState>): { store: FrancoAlertsDataStore; state: StoreState } {
  const s: StoreState = {
    employees: state.employees ?? [],
    dias: state.dias ?? [],
    admins: state.admins ?? [],
    recorded: state.recorded ? [...state.recorded] : [],
    recordShouldThrow: state.recordShouldThrow,
  };
  const store: FrancoAlertsDataStore = {
    async getActiveEmployees() {
      return s.employees;
    },
    async getAdmins() {
      return s.admins;
    },
    async getRecentDias(employeeIds, windowStart, today) {
      return s.dias.filter(
        (d) => employeeIds.includes(d.user_id) && d.fecha >= windowStart && d.fecha <= today
      );
    },
    async getSentAlerts(rows) {
      const employeeIds = rows.map((r) => r.employeeId);
      return s.recorded.filter((r) => employeeIds.includes(r.empleado_id));
    },
    async recordSent(rows) {
      if (s.recordShouldThrow) throw new Error('record fail');
      s.recorded.push(...rows);
    },
  };
  return { store, state: s };
}

describe('runFrancoAlerts: detección y envío', () => {
  it('empleado cruza el primer umbral (48, sin_franco): 1 email, 1 registro', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store, state } = makeStore({ employees: [EMP1], dias, admins: [admin('a1', 'a1@test.com')] });

    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res).toEqual({ employeesInAlert: 1, sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({
      empleado_id: 'emp-1',
      tipo: 'sin_franco',
      umbral: 48,
      recipient_profile_id: 'a1',
    });
  });

  it('nadie en alerta (streak por debajo del primer umbral): employeesInAlert=0, sin envíos', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dias = diasConsecutivos(EMP1.id, HOY, 10, 'trabajando'); // no alcanza 48
    const { store } = makeStore({ employees: [EMP1], dias, admins: [admin('a1', 'a1@test.com')] });

    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res).toEqual({ employeesInAlert: 0, sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('sin empleados activos: no consulta nada más, sin envíos', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { store } = makeStore({ employees: [], admins: [admin('a1', 'a1@test.com')] });
    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res).toEqual({ employeesInAlert: 0, sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('sin admins: no envía nada aunque haya empleados en alerta', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store } = makeStore({ employees: [EMP1], dias, admins: [] });
    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res.employeesInAlert).toBe(1);
    expect(res.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('el mail va SOLO a admins — nunca al email del empleado alertado', async () => {
    const sent: string[] = [];
    const send = vi.fn().mockImplementation((p: { to: string }) => {
      sent.push(p.to);
      return Promise.resolve();
    });
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store } = makeStore({ employees: [EMP1], dias, admins: [admin('a1', 'a1@test.com')] });
    await runFrancoAlerts({ store, send, today: HOY });
    expect(sent).toEqual(['a1@test.com']);
    expect(sent).not.toContain(EMP1.email);
  });

  it('dos admins: cada uno recibe su propio email individual', async () => {
    const sent: string[] = [];
    const send = vi.fn().mockImplementation((p: { to: string }) => {
      sent.push(p.to);
      return Promise.resolve();
    });
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store } = makeStore({
      employees: [EMP1],
      dias,
      admins: [admin('a1', 'a1@test.com'), admin('a2', 'a2@test.com')],
    });
    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res.sent).toBe(2);
    expect(sent.sort()).toEqual(['a1@test.com', 'a2@test.com']);
  });
});

describe('runFrancoAlerts: idempotencia por episodio (opción 1 — una vez por cruce de umbral)', () => {
  it('correr dos veces el mismo día con la misma racha no reenvía', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store } = makeStore({ employees: [EMP1], dias, admins: [admin('a1', 'a1@test.com')] });

    const r1 = await runFrancoAlerts({ store, send, today: HOY });
    expect(r1.sent).toBe(1);
    send.mockClear();

    const r2 = await runFrancoAlerts({ store, send, today: HOY });
    expect(r2.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('la misma racha que luego cruza el segundo umbral (60) genera un aviso nuevo', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dias48 = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store, state } = makeStore({ employees: [EMP1], dias: dias48, admins: [admin('a1', 'a1@test.com')] });

    await runFrancoAlerts({ store, send, today: HOY }); // registra umbral 48
    send.mockClear();

    // La racha sigue y ahora llega a 60 (mismo episodio, umbral distinto).
    state.dias = diasConsecutivos(EMP1.id, HOY, 60, 'trabajando');
    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res.sent).toBe(1); // solo el aviso nuevo de 60, no reenvía el de 48
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.recorded.some((r) => r.umbral === 60)).toBe(true);
    expect(state.recorded.some((r) => r.umbral === 48)).toBe(true); // el de 48 sigue registrado de antes
  });

  it('racha reseteada y vuelta a cruzar el MISMO umbral con otra racha_inicio: nuevo episodio → nuevo aviso', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    // Episodio viejo (ya notificado hace tiempo, fuera de la ventana de lectura actual).
    const episodioViejoInicio = fechaMenos(fechaMenos(HOY, 100), 47);
    const { store, state } = makeStore({
      employees: [EMP1],
      dias: diasConsecutivos(EMP1.id, HOY, 48, 'trabajando'), // episodio NUEVO, vigente hasta hoy
      admins: [admin('a1', 'a1@test.com')],
      recorded: [
        {
          empleado_id: EMP1.id,
          tipo: 'sin_franco',
          umbral: 48,
          racha_inicio: episodioViejoInicio,
          recipient_profile_id: 'a1',
        },
      ],
    });

    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res.sent).toBe(1); // mismo umbral (48), racha_inicio distinta → episodio nuevo
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.recorded).toHaveLength(2);
  });
});

describe('runFrancoAlerts: marcar-después-de-enviar y fallos', () => {
  it('fallo de envío NO registra el log → se reintenta la próxima corrida', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockRejectedValueOnce(new Error('gmail caído'));
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store, state } = makeStore({ employees: [EMP1], dias, admins: [admin('a1', 'a1@test.com')] });

    const r1 = await runFrancoAlerts({ store, send, today: HOY });
    expect(r1).toEqual({ employeesInAlert: 1, sent: 0, failed: 1 });
    expect(state.recorded).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();

    send.mockResolvedValue(undefined);
    const r2 = await runFrancoAlerts({ store, send, today: HOY });
    expect(r2.sent).toBe(1);
    errorSpy.mockRestore();
  });

  it('fallo parcial: un admin falla, el otro igual recibe y se registra', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockImplementation((p: { to: string }) => {
      if (p.to === 'a1@test.com') return Promise.reject(new Error('fallo a1'));
      return Promise.resolve();
    });
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store, state } = makeStore({
      employees: [EMP1],
      dias,
      admins: [admin('a1', 'a1@test.com'), admin('a2', 'a2@test.com')],
    });

    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res).toEqual({ employeesInAlert: 1, sent: 1, failed: 1 });
    const recipients = state.recorded.map((r) => r.recipient_profile_id);
    expect(recipients).toContain('a2');
    expect(recipients).not.toContain('a1');
    errorSpy.mockRestore();
  });

  it('admin sin email: se omite con warning, sin crash ni envío', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(undefined);
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store, state } = makeStore({ employees: [EMP1], dias, admins: [admin('a1', null)] });

    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(state.recorded).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('email enviado pero el registro falla: cuenta como enviado y loguea (no silencioso)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(undefined);
    const dias = diasConsecutivos(EMP1.id, HOY, 48, 'trabajando');
    const { store } = makeStore({
      employees: [EMP1],
      dias,
      admins: [admin('a1', 'a1@test.com')],
      recordShouldThrow: true,
    });

    const res = await runFrancoAlerts({ store, send, today: HOY });
    expect(res.sent).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('buildFrancoAlertEmail (es-AR, terminología amigable)', () => {
  it('incluye el nombre del empleado y la alerta combinada; nada de "racha"/"umbral"', () => {
    const email = buildFrancoAlertEmail({
      to: 'admin@test.com',
      empleadoName: 'Juan Pérez',
      tipo: 'sin_franco',
      valor: 52,
    });
    expect(email.subject).toBe(copy.emails.alertaFranco.subject);
    expect(email.text).toContain('Juan Pérez');
    expect(email.text).toContain('52 días sin descanso');
    expect(email.text.toLowerCase()).not.toMatch(/racha|umbral/);
    expect(email.html.toLowerCase()).not.toMatch(/racha|umbral/);
  });

  it('franco_excedido usa "franco prolongado"', () => {
    const email = buildFrancoAlertEmail({
      to: 'admin@test.com',
      empleadoName: 'Ana Ruiz',
      tipo: 'franco_excedido',
      valor: 12,
    });
    expect(email.text).toContain('12 días de franco prolongado');
  });

  it('escapa HTML en valores dinámicos', () => {
    const email = buildFrancoAlertEmail({
      to: 'admin@test.com',
      empleadoName: '<b>hack</b>',
      tipo: 'franco_excedido',
      valor: 12,
    });
    expect(email.html).not.toContain('<b>hack</b>');
    expect(email.html).toContain('&lt;b&gt;');
  });
});
