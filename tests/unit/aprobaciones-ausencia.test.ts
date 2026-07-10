/**
 * FB-F3-19 — Cola de aprobación de ausencias: orquestación de las server
 * actions que invocan resolver_ausencia_request (0013) + notificación por mail.
 *
 * Cubre, con supabase y el envío de mail SIEMPRE mockeados (nada toca la red
 * ni Postgres real — la RPC en sí ya está probada contra Postgres real en
 * tests/integration/resolver-ausencia-request.test.ts):
 *  - Aprobar: invoca la RPC con p_accion='aprobar', envía el mail de
 *    aprobación en éxito, revalida.
 *  - Rechazar: motivo vacío → copy amigable, NO llama la RPC. Con motivo →
 *    invoca la RPC con p_accion='rechazar' + el motivo, envía el mail con
 *    el motivo.
 *  - Condición de carrera (RPC aborta "ya fue resuelta"): copy amigable,
 *    revalida, NO envía mail, no propaga el error crudo de Postgres.
 *  - Cualquier otro error de RPC: error genérico visible, no se traga.
 *  - Mail best-effort: RPC OK + falla la notificación → la resolución no se
 *    revierte (no throw), se loguea, y la action devuelve emailSent:false
 *    para que la UI muestre un aviso suave.
 *  - Límite de rol (admin / supervisor / empleado) sobre ambas actions.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks de módulos server-only ANTES de importar el código bajo prueba ──────
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/email/ausencia-resolution-email', () => ({
  sendAusenciaApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendAusenciaRejectionEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import {
  sendAusenciaApprovalEmail,
  sendAusenciaRejectionEmail,
} from '@/lib/email/ausencia-resolution-email';
import { approveAusencia, rejectAusencia } from '@/app/(app)/aprobaciones/ausencia-actions';
import { copy } from '@/lib/copy';

type RequestData = {
  estado: string;
  motivo_ausencia: string;
  fecha_inicio: string;
  user_profile: { full_name: string | null; email: string | null } | null;
} | null;

interface ServerClientOptions {
  role?: string;
  userId?: string;
  rpcError?: { message: string; code?: string } | null;
  requestData?: RequestData;
  requestError?: unknown;
}

// requestData sirve tanto para la revalidación de scope (assertInQueueScope:
// estado + motivo_ausencia) como para la notificación post-resolución
// (fetchRequestForNotification: fecha_inicio + user_profile) — el mock no
// distingue qué columnas pidió cada .select(), así que una sola fila
// "superset" alcanza para ambas llamadas.
function makeServerClient(opts: ServerClientOptions = {}) {
  const {
    role = 'admin',
    userId = 'admin-id',
    rpcError = null,
    requestData = {
      estado: 'pendiente',
      motivo_ausencia: 'dia_tramite',
      fecha_inicio: '2027-03-15',
      user_profile: { full_name: 'Owner Test', email: 'owner@test.com' },
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
      if (table === 'ausencia_requests') {
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

describe('approveAusencia: happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invoca la RPC con p_accion=aprobar, envía el mail y revalida', async () => {
    const client = mockClient();

    const result = await approveAusencia('req-1');

    expect(client.rpc).toHaveBeenCalledWith(
      'resolver_ausencia_request',
      expect.objectContaining({ p_request_id: 'req-1', p_accion: 'aprobar' })
    );
    expect(sendAusenciaApprovalEmail).toHaveBeenCalledWith({
      to: 'owner@test.com',
      fullName: 'Owner Test',
      fechaInicio: '2027-03-15',
    });
    expect(result).toEqual({ emailSent: true });
    expect(revalidatePath).toHaveBeenCalledWith('/aprobaciones');
    expect(revalidatePath).toHaveBeenCalledWith('/calendario');
  });

  it('caso email nulo: loguea el skip, no envía, no crashea', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockClient({
      requestData: {
        estado: 'pendiente',
        motivo_ausencia: 'dia_tramite',
        fecha_inicio: '2027-03-15',
        user_profile: { full_name: 'Sin Mail', email: null },
      },
    });

    const result = await approveAusencia('req-1');

    expect(sendAusenciaApprovalEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ emailSent: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('mail best-effort: el envío falla → la resolución no se revierte, se loguea, emailSent:false', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendAusenciaApprovalEmail).mockRejectedValueOnce(new Error('gmail caído'));
    mockClient();

    await expect(approveAusencia('req-1')).resolves.toEqual({ emailSent: false });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email]'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

describe('rejectAusencia: happy path y validación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('motivo vacío: copy amigable, NO llama la RPC ni envía mail', async () => {
    const client = mockClient();

    await expect(rejectAusencia('req-1', '   ')).rejects.toThrow(
      copy.aprobaciones.rejectModal.motivoRequired
    );
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendAusenciaRejectionEmail).not.toHaveBeenCalled();
  });

  it('con motivo: invoca la RPC con p_accion=rechazar + motivo trimeado, envía el mail con el motivo', async () => {
    const client = mockClient();

    const result = await rejectAusencia('req-1', '  No corresponde  ');

    expect(client.rpc).toHaveBeenCalledWith(
      'resolver_ausencia_request',
      expect.objectContaining({
        p_request_id: 'req-1',
        p_accion: 'rechazar',
        p_motivo_rechazo: 'No corresponde',
      })
    );
    expect(sendAusenciaRejectionEmail).toHaveBeenCalledWith({
      to: 'owner@test.com',
      fullName: 'Owner Test',
      fechaInicio: '2027-03-15',
      motivo: 'No corresponde',
    });
    expect(result).toEqual({ emailSent: true });
  });
});

describe('condición de carrera: la solicitud ya fue resuelta por otro admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approveAusencia: copy amigable, revalida, NO envía mail, no propaga el error crudo', async () => {
    mockClient({
      rpcError: { message: 'La solicitud req-1 ya fue resuelta (estado actual: aprobado)', code: '22023' },
    });

    await expect(approveAusencia('req-1')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(sendAusenciaApprovalEmail).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/aprobaciones');
  });

  it('rejectAusencia: copy amigable, revalida, NO envía mail', async () => {
    mockClient({
      rpcError: { message: 'La solicitud req-1 ya fue resuelta (estado actual: rechazado)', code: '22023' },
    });

    await expect(rejectAusencia('req-1', 'motivo')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(sendAusenciaRejectionEmail).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/aprobaciones');
  });
});

// ─── FB-F3-20: revalidación de scope server-side antes de la RPC ─────────

describe('scope de la cola (FB-F3-20): la RPC no limita motivo, la action sí', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approveAusencia: otro motivo (vacaciones) pendiente → outOfScope, NO llama la RPC ni manda mail', async () => {
    const client = mockClient({
      requestData: {
        estado: 'pendiente',
        motivo_ausencia: 'vacaciones',
        fecha_inicio: '2027-03-15',
        user_profile: { full_name: 'Owner Test', email: 'owner@test.com' },
      },
    });

    await expect(approveAusencia('req-1')).rejects.toThrow(copy.aprobaciones.messages.outOfScope);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendAusenciaApprovalEmail).not.toHaveBeenCalled();
  });

  it('rejectAusencia: otro motivo (vacaciones) pendiente → outOfScope, NO llama la RPC ni manda mail', async () => {
    const client = mockClient({
      requestData: {
        estado: 'pendiente',
        motivo_ausencia: 'vacaciones',
        fecha_inicio: '2027-03-15',
        user_profile: { full_name: 'Owner Test', email: 'owner@test.com' },
      },
    });

    await expect(rejectAusencia('req-1', 'motivo')).rejects.toThrow(copy.aprobaciones.messages.outOfScope);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendAusenciaRejectionEmail).not.toHaveBeenCalled();
  });

  it('approveAusencia: ya resuelta (estado aprobado) detectada en el pre-check → alreadyResolved, NO llega a invocar la RPC', async () => {
    const client = mockClient({
      requestData: {
        estado: 'aprobado',
        motivo_ausencia: 'dia_tramite',
        fecha_inicio: '2027-03-15',
        user_profile: { full_name: 'Owner Test', email: 'owner@test.com' },
      },
    });

    await expect(approveAusencia('req-1')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendAusenciaApprovalEmail).not.toHaveBeenCalled();
  });

  it('approveAusencia: solicitud inexistente en el pre-check → alreadyResolved, NO llega a invocar la RPC', async () => {
    const client = mockClient({ requestData: null, requestError: { message: 'no rows' } });

    await expect(approveAusencia('req-1')).rejects.toThrow(copy.aprobaciones.messages.alreadyResolved);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('regresión: día de trámite pendiente sigue resolviéndose normal (aprobar) y manda el mail', async () => {
    const client = mockClient();

    const result = await approveAusencia('req-1');

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(sendAusenciaApprovalEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ emailSent: true });
  });

  it('regresión: día de trámite pendiente sigue resolviéndose normal (rechazar) y manda el mail con el motivo', async () => {
    const client = mockClient();

    const result = await rejectAusencia('req-1', 'motivo real');

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(sendAusenciaRejectionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'motivo real' })
    );
    expect(result).toEqual({ emailSent: true });
  });
});

describe('cualquier otro error de la RPC: no se traga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approveAusencia: error genérico visible, logueado, no envía mail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClient({ rpcError: { message: 'Solo un administrador puede resolver solicitudes de ausencia', code: '42501' } });

    await expect(approveAusencia('req-1')).rejects.toThrow(copy.errors.generic);
    expect(sendAusenciaApprovalEmail).not.toHaveBeenCalled();
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
    await approveAusencia('req-1');
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });

  it('supervisor: redirige a /dashboard (bloqueado)', async () => {
    mockClient({ role: 'supervisor', userId: 'sup-id' });
    await approveAusencia('req-1');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado: redirige a /dashboard (bloqueado)', async () => {
    mockClient({ role: 'empleado', userId: 'emp-id' });
    await rejectAusencia('req-1', 'motivo');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
