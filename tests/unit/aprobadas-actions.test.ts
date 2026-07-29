/**
 * FB-F4-14 — Vista de Solicitudes Aprobadas: orquestación de las server
 * actions que invocan cancelar_editar_ausencia_aprobada /
 * cancelar_editar_pasaje_aprobado (0017) + notificación por mail.
 * Análogo a tests/unit/aprobaciones-pasaje.test.ts, pero para cancelar/editar
 * sobre una solicitud YA aprobada, no para aprobar/rechazar.
 *
 * Cubre, con supabase y el envío de mail SIEMPRE mockeados (nada toca la red
 * ni Postgres real — las RPCs en sí ya están probadas contra Postgres real
 * en tests/integration/cancelar-editar-post-aprobacion.test.ts):
 *  - Cancelar (ausencia y pasaje): comentario obligatorio (sin invocar la
 *    RPC), invoca la RPC con p_accion='cancelar', envía el mail con el
 *    comentario, revalida.
 *  - Editar fechas (ausencia y pasaje): valida no-retroactiva y (ausencia)
 *    rango no invertido ANTES de invocar la RPC; invoca con p_accion=
 *    'editar_fechas' + las fechas/días nuevos; el mail incluye fechas/días
 *    ANTERIORES (de la re-lectura previa) y NUEVOS (del input).
 *  - Guarda de vigencia: la solicitud ya no está aprobada o ya fue cancelada
 *    (re-lectura previa) → copy amigable, NO llega a invocar la RPC.
 *  - Traducción de errores de la RPC: bloqueo LIFO → copy con la lista de
 *    bloqueos; condición de carrera → "ya no vigente"; cualquier otro error
 *    → genérico visible, logueado, no se traga.
 *  - Mail best-effort: RPC OK + falla la notificación → no se revierte
 *    (no throw), se loguea, emailSent:false. Email ausente → se omite sin
 *    crashear.
 *  - Previsualización de sobrescritura (editar): días con fila (ok), sin
 *    días (ok vacío), fallo de query (error) — para ausencia y pasaje.
 *  - Límite de rol (admin / no-admin) sobre las cuatro actions.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/email/ausencia-post-aprobacion-email', () => ({
  sendAusenciaCanceladaEmail: vi.fn().mockResolvedValue(undefined),
  sendAusenciaEditadaEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/email/pasaje-post-aprobacion-email', () => ({
  sendPasajeCanceladoEmail: vi.fn().mockResolvedValue(undefined),
  sendPasajeEditadoEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import {
  sendAusenciaCanceladaEmail,
  sendAusenciaEditadaEmail,
} from '@/lib/email/ausencia-post-aprobacion-email';
import {
  sendPasajeCanceladoEmail,
  sendPasajeEditadoEmail,
} from '@/lib/email/pasaje-post-aprobacion-email';
import {
  cancelarAusencia,
  editarFechasAusencia,
  cancelarPasaje,
  editarFechasPasaje,
  previewOverwriteAusencia,
  previewOverwritePasaje,
} from '@/app/(app)/aprobadas/actions';
import { copy } from '@/lib/copy';

type AusenciaRow = {
  estado: string;
  post_aprobacion_tipo: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  motivo_ausencia: string;
  motivo_otros_texto: string | null;
  user_id?: string;
  user_profile: { full_name: string | null; email: string | null } | null;
} | null;

type PasajeRow = {
  estado: string;
  post_aprobacion_tipo: string | null;
  motivo_viaje: string;
  origen: string;
  destino: string;
  dias_viaje: string[] | null;
  empleado_id?: string;
  empleado_profile: { full_name: string | null; email: string | null } | null;
} | null;

type RotationRow = { fecha: string; estado_dia: string; es_estimado: boolean };

interface ServerClientOptions {
  role?: string;
  userId?: string;
  rpcError?: { message: string; code?: string } | null;
  ausenciaData?: AusenciaRow;
  pasajeData?: PasajeRow;
  rotationData?: RotationRow[];
  rotationError?: { message: string } | null;
}

const DEFAULT_AUSENCIA: AusenciaRow = {
  estado: 'aprobado',
  post_aprobacion_tipo: null,
  fecha_inicio: '2027-06-01',
  fecha_fin: '2027-06-03',
  motivo_ausencia: 'vacaciones',
  motivo_otros_texto: null,
  user_id: 'empleado-id',
  user_profile: { full_name: 'Empleado Test', email: 'empleado@test.com' },
};

const DEFAULT_PASAJE: PasajeRow = {
  estado: 'aprobado',
  post_aprobacion_tipo: null,
  motivo_viaje: 'traslado_proyectos',
  origen: 'Base',
  destino: 'Sitio',
  dias_viaje: ['2027-06-16', '2027-06-17'],
  empleado_id: 'empleado-id',
  empleado_profile: { full_name: 'Empleado Test', email: 'empleado@test.com' },
};

// Fila "superset": la misma fixture sirve tanto para la re-lectura de
// vigencia + notificación (columnas completas) como para el lookup de
// user_id/empleado_id que usan previewOverwrite* — el mock no distingue qué
// columnas pidió cada .select() (mismo criterio que aprobaciones-pasaje.test.ts).
function makeServerClient(opts: ServerClientOptions = {}) {
  const {
    role = 'admin',
    userId = 'admin-id',
    rpcError = null,
    ausenciaData = DEFAULT_AUSENCIA,
    pasajeData = DEFAULT_PASAJE,
    rotationData = [],
    rotationError = null,
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
              single: vi.fn().mockResolvedValue({ data: ausenciaData, error: ausenciaData ? null : { message: 'no rows' } }),
            })),
          })),
        };
      }
      if (table === 'pasaje_requests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: pasajeData, error: pasajeData ? null : { message: 'no rows' } }),
            })),
          })),
        };
      }
      if (table === 'rotation_assignments') {
        // Encadenable: .select().eq().gte().lte() (ausencia) o .select().eq().in() (pasaje).
        const chain: Record<string, unknown> = {};
        const result = rotationError
          ? Promise.resolve({ data: null, error: rotationError })
          : Promise.resolve({ data: rotationData, error: null });
        chain.eq = vi.fn(() => chain);
        chain.gte = vi.fn(() => chain);
        chain.lte = vi.fn(() => result);
        chain.in = vi.fn(() => result);
        return { select: vi.fn(() => chain) };
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

describe('cancelarAusencia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comentario vacío: copy amigable, NO llama la RPC ni envía mail', async () => {
    const client = mockClient();
    await expect(cancelarAusencia('req-1', '   ')).rejects.toThrow(
      copy.aprobadas.cancelModal.comentarioRequired
    );
    expect(client.rpc).not.toHaveBeenCalled();
    expect(sendAusenciaCanceladaEmail).not.toHaveBeenCalled();
  });

  it('happy path: invoca la RPC con p_accion=cancelar, envía el mail con el comentario, revalida', async () => {
    const client = mockClient();

    const result = await cancelarAusencia('req-1', '  Ya no corresponde  ');

    expect(client.rpc).toHaveBeenCalledWith(
      'cancelar_editar_ausencia_aprobada',
      expect.objectContaining({ p_request_id: 'req-1', p_accion: 'cancelar', p_comentario: 'Ya no corresponde' })
    );
    expect(sendAusenciaCanceladaEmail).toHaveBeenCalledWith({
      to: 'empleado@test.com',
      fullName: 'Empleado Test',
      fechaInicio: '2027-06-01',
      fechaFin: '2027-06-03',
      motivoAusencia: 'vacaciones',
      motivoOtrosTexto: null,
      comentario: 'Ya no corresponde',
    });
    expect(result).toEqual({ emailSent: true });
    expect(revalidatePath).toHaveBeenCalledWith('/aprobadas');
    expect(revalidatePath).toHaveBeenCalledWith('/solicitud-ausencia');
    expect(revalidatePath).toHaveBeenCalledWith('/calendario');
  });

  it('ya no vigente (pendiente): copy amigable, NO llega a invocar la RPC', async () => {
    const client = mockClient({ ausenciaData: { ...DEFAULT_AUSENCIA, estado: 'pendiente' } });
    await expect(cancelarAusencia('req-1', 'motivo')).rejects.toThrow(copy.aprobadas.errors.yaNoVigente);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('ya cancelada: copy amigable, NO llega a invocar la RPC', async () => {
    const client = mockClient({ ausenciaData: { ...DEFAULT_AUSENCIA, post_aprobacion_tipo: 'cancelada' } });
    await expect(cancelarAusencia('req-1', 'motivo')).rejects.toThrow(copy.aprobadas.errors.yaNoVigente);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('bloqueo LIFO: traduce el error de la RPC identificando qué resolver primero', async () => {
    mockClient({
      rpcError: {
        message:
          "No se puede cancelar la solicitud req-1: hay aprobaciones posteriores que se superponen y deben resolverse primero: pasaje abc-123 (2027-06-02, aprobada 2027-01-02 00:00:00+00)",
      },
    });

    await expect(cancelarAusencia('req-1', 'motivo')).rejects.toThrow(
      /pasaje abc-123 \(2027-06-02, aprobada/
    );
    expect(sendAusenciaCanceladaEmail).not.toHaveBeenCalled();
  });

  it('condición de carrera (RPC aborta "ya fue cancelada"): copy amigable, no mail', async () => {
    mockClient({ rpcError: { message: 'La solicitud req-1 ya fue cancelada' } });
    await expect(cancelarAusencia('req-1', 'motivo')).rejects.toThrow(copy.aprobadas.errors.yaNoVigente);
    expect(sendAusenciaCanceladaEmail).not.toHaveBeenCalled();
  });

  it('cualquier otro error de la RPC: genérico visible, logueado, no se traga', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClient({ rpcError: { message: 'Solo un administrador puede cancelar o editar una ausencia aprobada' } });

    await expect(cancelarAusencia('req-1', 'motivo')).rejects.toThrow(copy.aprobadas.errors.generic);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('email ausente: se omite el envío sin crashear', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockClient({ ausenciaData: { ...DEFAULT_AUSENCIA, user_profile: { full_name: 'Sin Mail', email: null } } });

    const result = await cancelarAusencia('req-1', 'motivo');
    expect(sendAusenciaCanceladaEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ emailSent: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('mail best-effort: falla el envío → no se revierte, se loguea, emailSent:false', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendAusenciaCanceladaEmail).mockRejectedValueOnce(new Error('gmail caído'));
    mockClient();

    await expect(cancelarAusencia('req-1', 'motivo')).resolves.toEqual({ emailSent: false });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[email]'), expect.any(Error));
    errorSpy.mockRestore();
  });
});

describe('editarFechasAusencia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comentario vacío: copy amigable, NO llama la RPC', async () => {
    const client = mockClient();
    await expect(editarFechasAusencia('req-1', '  ', '2027-07-01', '2027-07-02')).rejects.toThrow(
      copy.aprobadas.editModal.comentarioRequired
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rango invertido: copy amigable, NO llama la RPC (validado antes de invocarla)', async () => {
    const client = mockClient();
    await expect(editarFechasAusencia('req-1', 'motivo', '2027-07-05', '2027-07-01')).rejects.toThrow(
      copy.aprobadas.errors.fechaFinAnteriorAInicio
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('fecha retroactiva: copy amigable, NO llama la RPC', async () => {
    const client = mockClient();
    await expect(editarFechasAusencia('req-1', 'motivo', '2020-01-01', '2020-01-02')).rejects.toThrow(
      copy.aprobadas.errors.fechaRetroactiva
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('happy path: invoca la RPC con las fechas nuevas, el mail incluye anteriores y nuevas', async () => {
    const client = mockClient();

    const result = await editarFechasAusencia('req-1', 'corrección', '2027-09-05', '2027-09-06');

    expect(client.rpc).toHaveBeenCalledWith(
      'cancelar_editar_ausencia_aprobada',
      expect.objectContaining({
        p_request_id: 'req-1',
        p_accion: 'editar_fechas',
        p_comentario: 'corrección',
        p_nueva_fecha_inicio: '2027-09-05',
        p_nueva_fecha_fin: '2027-09-06',
      })
    );
    expect(sendAusenciaEditadaEmail).toHaveBeenCalledWith({
      to: 'empleado@test.com',
      fullName: 'Empleado Test',
      fechaInicioAnterior: '2027-06-01',
      fechaFinAnterior: '2027-06-03',
      fechaInicioNueva: '2027-09-05',
      fechaFinNueva: '2027-09-06',
      motivoAusencia: 'vacaciones',
      motivoOtrosTexto: null,
      comentario: 'corrección',
    });
    expect(result).toEqual({ emailSent: true });
  });

  it('ya no vigente: NO llega a invocar la RPC', async () => {
    const client = mockClient({ ausenciaData: { ...DEFAULT_AUSENCIA, post_aprobacion_tipo: 'cancelada' } });
    await expect(editarFechasAusencia('req-1', 'motivo', '2027-09-05', '2027-09-06')).rejects.toThrow(
      copy.aprobadas.errors.yaNoVigente
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('cancelarPasaje', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comentario vacío: copy amigable, NO llama la RPC', async () => {
    const client = mockClient();
    await expect(cancelarPasaje('req-1', '')).rejects.toThrow(copy.aprobadas.cancelModal.comentarioRequired);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('happy path: invoca la RPC con p_accion=cancelar, envía el mail con el comentario', async () => {
    const client = mockClient();

    const result = await cancelarPasaje('req-1', 'viaje suspendido');

    expect(client.rpc).toHaveBeenCalledWith(
      'cancelar_editar_pasaje_aprobado',
      expect.objectContaining({ p_request_id: 'req-1', p_accion: 'cancelar', p_comentario: 'viaje suspendido' })
    );
    expect(sendPasajeCanceladoEmail).toHaveBeenCalledWith({
      to: 'empleado@test.com',
      fullName: 'Empleado Test',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: ['2027-06-16', '2027-06-17'],
      comentario: 'viaje suspendido',
    });
    expect(result).toEqual({ emailSent: true });
    expect(revalidatePath).toHaveBeenCalledWith('/aprobadas');
    expect(revalidatePath).toHaveBeenCalledWith('/solicitud-pasaje');
  });

  it('bloqueo LIFO: traduce el error identificando qué resolver primero', async () => {
    mockClient({
      rpcError: {
        message:
          "No se puede cancelar la solicitud req-1: hay aprobaciones posteriores que se superponen y deben resolverse primero: ausencia xyz-789 (2027-06-16 a 2027-06-17, aprobada 2027-01-03 00:00:00+00)",
      },
    });

    await expect(cancelarPasaje('req-1', 'motivo')).rejects.toThrow(/ausencia xyz-789/);
    expect(sendPasajeCanceladoEmail).not.toHaveBeenCalled();
  });
});

describe('editarFechasPasaje', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin días: copy amigable, NO llama la RPC', async () => {
    const client = mockClient();
    await expect(editarFechasPasaje('req-1', 'motivo', [])).rejects.toThrow(
      copy.aprobadas.errors.diasRequeridos
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('día retroactivo: copy amigable, NO llama la RPC', async () => {
    const client = mockClient();
    await expect(editarFechasPasaje('req-1', 'motivo', ['2020-01-01'])).rejects.toThrow(
      copy.aprobadas.errors.diaRetroactivo
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('happy path: dedupea/ordena los días, invoca la RPC, el mail incluye anteriores y nuevos', async () => {
    const client = mockClient();

    const result = await editarFechasPasaje('req-1', 'cambio de itinerario', ['2027-09-16', '2027-09-15', '2027-09-15']);

    expect(client.rpc).toHaveBeenCalledWith(
      'cancelar_editar_pasaje_aprobado',
      expect.objectContaining({
        p_request_id: 'req-1',
        p_accion: 'editar_fechas',
        p_comentario: 'cambio de itinerario',
        p_nuevos_dias: ['2027-09-15', '2027-09-16'],
      })
    );
    expect(sendPasajeEditadoEmail).toHaveBeenCalledWith({
      to: 'empleado@test.com',
      fullName: 'Empleado Test',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViajeAnteriores: ['2027-06-16', '2027-06-17'],
      diasViajeNuevos: ['2027-09-15', '2027-09-16'],
      comentario: 'cambio de itinerario',
    });
    expect(result).toEqual({ emailSent: true });
  });
});

describe('previsualización de sobrescritura (editar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previewOverwriteAusencia: días con fila → ok con los días', async () => {
    mockClient({ rotationData: [{ fecha: '2027-09-05', estado_dia: 'trabajando', es_estimado: false }] });
    const result = await previewOverwriteAusencia('req-1', '2027-09-05', '2027-09-06');
    expect(result).toEqual({ status: 'ok', days: [{ fecha: '2027-09-05', estado_dia: 'trabajando', es_estimado: false }] });
  });

  it('previewOverwriteAusencia: sin días con fila → ok vacío (no "error")', async () => {
    mockClient({ rotationData: [] });
    const result = await previewOverwriteAusencia('req-1', '2027-09-05', '2027-09-06');
    expect(result).toEqual({ status: 'ok', days: [] });
  });

  it('previewOverwriteAusencia: falla la query → error visible, no ok vacío disfrazado', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClient({ rotationError: { message: 'timeout' } });
    const result = await previewOverwriteAusencia('req-1', '2027-09-05', '2027-09-06');
    expect(result).toEqual({ status: 'error' });
    errorSpy.mockRestore();
  });

  it('previewOverwritePasaje: días con fila → ok con los días', async () => {
    mockClient({ rotationData: [{ fecha: '2027-09-15', estado_dia: 'en_viaje', es_estimado: false }] });
    const result = await previewOverwritePasaje('req-1', ['2027-09-15']);
    expect(result).toEqual({ status: 'ok', days: [{ fecha: '2027-09-15', estado_dia: 'en_viaje', es_estimado: false }] });
  });

  it('previewOverwritePasaje: array de días vacío → ok vacío sin consultar la DB', async () => {
    const client = mockClient();
    const result = await previewOverwritePasaje('req-1', []);
    expect(result).toEqual({ status: 'ok', days: [] });
    expect(client.from).not.toHaveBeenCalledWith('rotation_assignments');
  });

  it('previewOverwritePasaje: falla la query → error visible', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClient({ rotationError: { message: 'timeout' } });
    const result = await previewOverwritePasaje('req-1', ['2027-09-15']);
    expect(result).toEqual({ status: 'error' });
    errorSpy.mockRestore();
  });
});

describe('límite de rol (admin / no-admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: NO redirige a /dashboard (acceso permitido)', async () => {
    mockClient({ role: 'admin', userId: 'admin-id' });
    await cancelarAusencia('req-1', 'motivo');
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });

  it('supervisor: redirige a /dashboard (bloqueado)', async () => {
    mockClient({ role: 'supervisor', userId: 'sup-id' });
    await cancelarPasaje('req-1', 'motivo');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado: redirige a /dashboard (bloqueado)', async () => {
    mockClient({ role: 'empleado', userId: 'emp-id' });
    await editarFechasAusencia('req-1', 'motivo', '2027-09-05', '2027-09-06');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
