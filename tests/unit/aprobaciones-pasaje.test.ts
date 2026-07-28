/**
 * FB-F4-10 — Cola de aprobación de pasajes: orquestación de las server
 * actions que invocan resolver_pasaje_request (0016) + notificación por mail.
 * Análogo a tests/unit/aprobaciones-ausencia.test.ts (FB-F3-19).
 *
 * Cubre, con supabase y el envío de mail SIEMPRE mockeados (nada toca la red
 * ni Postgres real — la RPC en sí ya está probada contra Postgres real en
 * tests/integration/resolver-pasaje-request.test.ts):
 *  - Aprobar: invoca la RPC con p_accion='aprobar', envía el mail de
 *    aprobación al EMPLEADO (quien viaja, no necesariamente el solicitante),
 *    revalida.
 *  - Rechazar: motivo vacío → copy amigable, NO llama la RPC. Con motivo →
 *    invoca la RPC con p_accion='rechazar' + el motivo, envía el mail con
 *    el motivo.
 *  - Condición de carrera (RPC aborta "ya fue resuelta"): copy amigable,
 *    revalida, NO envía mail, no propaga el error crudo de Postgres.
 *  - Cualquier otro error de RPC: error genérico visible, no se traga.
 *  - Mail best-effort: RPC OK + falla la notificación → la resolución no se
 *    revierte (no throw), se loguea, y la action devuelve emailSent:false.
 *  - Límite de rol (admin / supervisor / empleado) sobre ambas actions.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/email/pasaje-resolution-email', () => ({
  sendPasajeApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendPasajeRejectionEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import {
  sendPasajeApprovalEmail,
  sendPasajeRejectionEmail,
} from '@/lib/email/pasaje-resolution-email';
import { approvePasaje, rejectPasaje } from '@/app/(app)/aprobaciones/pasaje-actions';
import { copy } from '@/lib/copy';

type RequestData = {
  estado: string;
  motivo_viaje: string;
  origen: string;
  destino: string;
  dias_viaje: string[] | null;
  empleado_profile: { full_name: string | null; email: string | null } | null;
} | null;

interface ServerClientOptions {
  role?: string;
  userId?: string;
  rpcError?: { message: string; code?: string } | null;
  requestData?: RequestData;
  requestError?: unknown;
}

// requestData sirve tanto para la revalidación de pendiente (assertPendiente:
// estado) como para la notificación post-resolución (fetchRequestForNotification:
// motivo_viaje/origen/destino/dias_viaje/empleado_profile) — el mock no
// distingue qué columnas pidió cada .select(), así que una sola fila
// "superset" alcanza para ambas llamadas.
function makeServerClient(opts: ServerClientOptions = {}) {
  const {
    role = 'admin',
    userId = 'admin-id',
    rpcError = null,
    requestData = {
      estado: 'pendiente',
      motivo_viaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      dias_viaje: ['2027-06-16', '2027-06-17'],
      empleado_profile: { full_name: 'Empleado Test', email: 'empleado@test.com' },
    },
    requestError = null,
  } = opts;

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

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: profile, error: null }),
            })),
          })),
        };
      }
      if (table === 'pasaje_requests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: requestData, error: requestError }),
            })),
          })),
        };
      }
      throw new Error(`tabla no mockeada en el test: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ error: rpcError }),
  };
}

function mockClient(opts: ServerClientOptions = {}) {
  const client = makeServerClient(opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return client;
}

describe('approvePasaje: happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invoca la RPC con p_accion=aprobar, envía el mail al empleado y revalida', async () => {
    const client = mockClient();

    const result = await approvePasaje('req-1');

    expect(client.rpc).toHaveBeenCalledWith(
      'resolver_pasaje_request',
      expect.objectContaining({ p_request_id: 'req-1', p_accion: 'aprobar' })
    );
    expect(sendPasajeApprovalEmail).toHaveBeenCalledWith({
      to: 'empleado@test.com',
      fullName: 'Empleado Test',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: ['2027-06-16', '2027-06-17'],
    });
    expect(result).toEqual({ emailSent: true });
    expect(revalidatePath).toHaveBeenCalledWith('/aprobaciones');
    expect(revalidatePath).toHaveBeenCalledWith('/calendario');
    expect(revalidatePath).toHaveBeenCalledWith('/solicitud-pasaje');
  });

  it('caso email nulo: loguea el skip, no envía, no crashea', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockClient({
      requestData: {
        estado: 'pendiente',
        motivo_viaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        dias_viaje: ['2027-06-16'],
        empleado_profile: { full_name: 'Sin Mail', email: null },
      },
    });

    const result = await approvePasaje('req-1');

    expect(sendPasajeApprovalEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ emailSent: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('mail best-effort: el envío falla → la resolución no se revierte, se loguea, emailSent:false', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendPasajeApprovalEmail).mockRejectedValueOnce(new Error('gmail caído'));
    mockClient();

    await expect(approvePasaje('req-1')).resolves.toEqual({ emailSent: false });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email]'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('dias_viaje NULL (fila legacy) no crashea el mail: se envía con lista vacía', async () => {
    mockClient({
      requestData: {
        estado: 'pendiente',
        motivo_viaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        dias_viaje: null,
        empleado_profile: { full_name: 'Empleado Test', email: 'empleado@test.com' },
      },
    });

    const result = await approvePasaje('req-1');

    expect(sendPasajeApprovalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ diasViaje: [] })
    );
    expect(result).toEqual({ emailSent: true });
  });
});

describe('rejectPasaje: happy path y validación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('motivo vacío: copy amigable, NO llama la RPC ni envía mail', async () => {
    const client = mockClient();

    await expect(rejectPasaje('req-1', '   ')).rejects.toThrow(
      copy.aprobaciones.rejectModal.motivoRequired
    );
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendPasajeRejectionEmail).not.toHaveBeenCalled();
  });

  it('con motivo: invoca la RPC con p_accion=rechazar + motivo trimeado, envía el mail con el motivo', async () => {
    const client = mockClient();

    const result = await rejectPasaje('req-1', '  No hay presupuesto  ');

    expect(client.rpc).toHaveBeenCalledWith(
      'resolver_pasaje_request',
      expect.objectContaining({
        p_request_id: 'req-1',
        p_accion: 'rechazar',
        p_motivo_rechazo: 'No hay presupuesto',
      })
    );
    expect(sendPasajeRejectionEmail).toHaveBeenCalledWith({
      to: 'empleado@test.com',
      fullName: 'Empleado Test',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: ['2027-06-16', '2027-06-17'],
      motivoRechazo: 'No hay presupuesto',
    });
    expect(result).toEqual({ emailSent: true });
  });
});

describe('condición de carrera: la solicitud ya fue resuelta por otro admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approvePasaje: copy amigable, revalida, NO envía mail, no propaga el error crudo', async () => {
    mockClient({
      rpcError: { message: 'La solicitud req-1 ya fue resuelta (estado actual: aprobado)', code: '22023' },
    });

    await expect(approvePasaje('req-1')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(sendPasajeApprovalEmail).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/aprobaciones');
  });

  it('rejectPasaje: copy amigable, revalida, NO envía mail', async () => {
    mockClient({
      rpcError: { message: 'La solicitud req-1 ya fue resuelta (estado actual: rechazado)', code: '22023' },
    });

    await expect(rejectPasaje('req-1', 'motivo')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(sendPasajeRejectionEmail).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/aprobaciones');
  });

  it('approvePasaje: ya resuelta detectada en el pre-check → alreadyResolved, NO llega a invocar la RPC', async () => {
    const client = mockClient({
      requestData: {
        estado: 'aprobado',
        motivo_viaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        dias_viaje: ['2027-06-16'],
        empleado_profile: { full_name: 'Empleado Test', email: 'empleado@test.com' },
      },
    });

    await expect(approvePasaje('req-1')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendPasajeApprovalEmail).not.toHaveBeenCalled();
  });

  it('approvePasaje: solicitud inexistente en el pre-check → alreadyResolved, NO llega a invocar la RPC', async () => {
    const client = mockClient({ requestData: null, requestError: { message: 'no rows' } });

    await expect(approvePasaje('req-1')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('cualquier otro error de la RPC: no se traga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approvePasaje: error genérico visible, logueado, no envía mail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClient({ rpcError: { message: 'Solo un administrador puede resolver solicitudes de pasaje', code: '42501' } });

    await expect(approvePasaje('req-1')).rejects.toThrow(copy.errors.generic);
    expect(sendPasajeApprovalEmail).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('límite de rol (admin / supervisor / empleado)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: NO redirige a /dashboard (acceso permitido)', async () => {
    mockClient({ role: 'admin', userId: 'admin-id' });
    await approvePasaje('req-1');
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });

  it('supervisor: redirige a /dashboard (bloqueado)', async () => {
    mockClient({ role: 'supervisor', userId: 'sup-id' });
    await approvePasaje('req-1');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado: redirige a /dashboard (bloqueado)', async () => {
    mockClient({ role: 'empleado', userId: 'emp-id' });
    await rejectPasaje('req-1', 'motivo');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
