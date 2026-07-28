/**
 * Solicitud de Pasaje (FB-F4-10) — formulario nativo, análogo a
 * solicitud-ausencia.test.ts (FB-F4-05).
 *
 * Mockea @/lib/auth (requireAuth) y @/lib/supabase/server (createServerClient)
 * para ejercitar la server action y la page real sin tocar la base. La RPC
 * resolver_pasaje_request y sus guardas ya están probadas contra Postgres real
 * en tests/integration/resolver-pasaje-request.test.ts; acá se testea que el
 * código de la app arma el payload correcto, resuelve empleado_id sin confiar
 * en el cliente (self para empleado, equipo revalidado para supervisor),
 * valida el array de días y la no-retroactiva server-side, y traduce
 * cualquier error de insert al genérico en vez de propagarlo crudo.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { createPasajeRequest } from '@/app/(app)/solicitud-pasaje/actions';
import { validatePasajeRequestInput } from '@/app/(app)/solicitud-pasaje/logic';
import SolicitudPasajePage from '@/app/(app)/solicitud-pasaje/page';
import { SolicitudPasajeForm } from '@/app/(app)/solicitud-pasaje/SolicitudPasajeForm';
import { MisSolicitudesPasajeTable } from '@/app/(app)/solicitud-pasaje/MisSolicitudesPasajeTable';
import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';

function mockProfile(role: 'admin' | 'supervisor' | 'empleado', id = 'user-1') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAuth).mockResolvedValue({
    id,
    role,
    full_name: `Test ${role}`,
    email: `${id}@test.com`,
  } as any);
}

// Mockea el cliente para createPasajeRequest: la tabla 'profiles' sirve para
// la revalidación de equipo del supervisor (.select().eq().eq().maybeSingle()),
// 'pasaje_requests' para el INSERT final.
function mockSupabaseClient(
  opts: {
    memberExists?: boolean;
    memberError?: { message: string } | null;
    insertError?: { message: string } | null;
  } = {}
) {
  const { memberExists = true, memberError = null, insertError = null } = opts;

  const insertMock = vi.fn().mockResolvedValue({ error: insertError });
  const maybeSingleMock = vi.fn().mockResolvedValue({
    data: memberExists ? { id: 'member-id' } : null,
    error: memberError,
  });
  const eqSupervisorMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const eqIdMock = vi.fn().mockReturnValue({ eq: eqSupervisorMock });
  const selectProfilesMock = vi.fn().mockReturnValue({ eq: eqIdMock });

  const fromMock = vi.fn((table: string) => {
    if (table === 'profiles') return { select: selectProfilesMock };
    if (table === 'pasaje_requests') return { insert: insertMock };
    throw new Error(`tabla no mockeada en el test: ${table}`);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { insertMock, maybeSingleMock, eqSupervisorMock, eqIdMock, fromMock };
}

const MANANA = '2027-06-16';
const PASADO_MANANA = '2027-06-17';

// ─── createPasajeRequest: gating, scope y payload (FB-F4-10) ───────────────

describe('createPasajeRequest: gating e integridad del purgatorio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: rechazado antes de llamar insert (modo consulta, no envía)', async () => {
    mockProfile('admin');
    const { insertMock } = mockSupabaseClient();

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.errors.unauthorized);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: sin motivo rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseClient();

    await expect(
      createPasajeRequest({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        motivoViaje: '' as any,
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.motivoRequerido);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: sin origen rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseClient();

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: '   ',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.origenRequerido);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: sin destino rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseClient();

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: '',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.destinoRequerido);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: dias_viaje vacío rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseClient();

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.diasRequeridos);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: algún día de dias_viaje anterior a hoy rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseClient();
    const ayer = '2020-01-01';

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA, ayer],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.diaRetroactivo);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: NUNCA puede spoofear empleado_id — se fuerza a sí mismo aunque el input traiga otro id', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseClient();

    await createPasajeRequest({
      empleadoId: 'otro-empleado-cualquiera',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: [MANANA],
    });

    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ solicitante_id: 'emp-1', empleado_id: 'emp-1', estado: 'pendiente' }),
    ]);
  });

  it('empleado: inserta con payload correcto (motivo, origen/destino trimeados, dias_viaje ordenados, fecha_viaje legacy = primer día)', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock, fromMock } = mockSupabaseClient();

    await createPasajeRequest({
      motivoViaje: 'inicio_franco',
      origen: '  Mendoza  ',
      destino: '  Bahía Blanca  ',
      diasViaje: [PASADO_MANANA, MANANA, MANANA], // desordenado + duplicado
      nota: '  Viaje de rutina  ',
    });

    expect(fromMock).toHaveBeenCalledWith('pasaje_requests');
    expect(insertMock).toHaveBeenCalledWith([
      {
        solicitante_id: 'emp-1',
        empleado_id: 'emp-1',
        motivo_viaje: 'inicio_franco',
        fecha_viaje: MANANA,
        origen: 'Mendoza',
        destino: 'Bahía Blanca',
        dias_viaje: [MANANA, PASADO_MANANA],
        notas: 'Viaje de rutina',
        estado: 'pendiente',
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/solicitud-pasaje');
  });

  it('empleado: nota vacía o solo espacios se guarda como null', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseClient();

    await createPasajeRequest({
      motivoViaje: 'fin_franco',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: [MANANA],
      nota: '   ',
    });

    expect(insertMock).toHaveBeenCalledWith([expect.objectContaining({ notas: null })]);
  });

  it('supervisor: sin empleadoId rechaza antes de llamar insert', async () => {
    mockProfile('supervisor', 'sup-1');
    const { insertMock } = mockSupabaseClient();

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.empleadoRequerido);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('supervisor: pide para sí mismo — no consulta el equipo, inserta directo', async () => {
    mockProfile('supervisor', 'sup-1');
    const { insertMock, eqIdMock } = mockSupabaseClient();

    await createPasajeRequest({
      empleadoId: 'sup-1',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: [MANANA],
    });

    expect(eqIdMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ solicitante_id: 'sup-1', empleado_id: 'sup-1' }),
    ]);
  });

  it('supervisor: pide para un integrante de su equipo (revalidado server-side) — inserta con ese empleado_id', async () => {
    mockProfile('supervisor', 'sup-1');
    const { insertMock, eqIdMock, eqSupervisorMock } = mockSupabaseClient({ memberExists: true });

    await createPasajeRequest({
      empleadoId: 'emp-equipo',
      motivoViaje: 'traslado_proyectos',
      origen: 'Base',
      destino: 'Sitio',
      diasViaje: [MANANA],
    });

    expect(eqIdMock).toHaveBeenCalledWith('id', 'emp-equipo');
    expect(eqSupervisorMock).toHaveBeenCalledWith('supervisor_id', 'sup-1');
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ solicitante_id: 'sup-1', empleado_id: 'emp-equipo' }),
    ]);
  });

  it('supervisor: pide para alguien fuera de su equipo — rechazado antes de llamar insert', async () => {
    mockProfile('supervisor', 'sup-1');
    const { insertMock } = mockSupabaseClient({ memberExists: false });

    await expect(
      createPasajeRequest({
        empleadoId: 'emp-de-otro-equipo',
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.solicitudPasaje.errors.empleadoFueraDeEquipo);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('supervisor: la query de validación de equipo falla → error genérico, no propaga el error crudo', async () => {
    mockProfile('supervisor', 'sup-1');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { insertMock } = mockSupabaseClient({ memberError: { message: 'db error' } });

    await expect(
      createPasajeRequest({
        empleadoId: 'emp-equipo',
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.errors.generic);
    expect(insertMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('otros errores de Supabase al insertar se traducen al genérico es-AR, nunca se tragan ni muestran crudos', async () => {
    mockProfile('empleado', 'emp-1');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabaseClient({ insertError: { message: 'internal db error xyz' } });

    await expect(
      createPasajeRequest({
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA],
      })
    ).rejects.toThrow(copy.errors.generic);
    errorSpy.mockRestore();
  });
});

// ─── validatePasajeRequestInput (unidad pura) ──────────────────────────────

describe('validatePasajeRequestInput: motivo, origen/destino, días y no-retroactiva', () => {
  const HOY = '2027-06-15';

  it('motivo vacío → error', () => {
    const result = validatePasajeRequestInput(
      { motivoViaje: '', origen: 'Base', destino: 'Sitio', diasViaje: [MANANA] },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudPasaje.errors.motivoRequerido });
  });

  it('origen vacío o solo espacios → error', () => {
    const result = validatePasajeRequestInput(
      { motivoViaje: 'traslado_proyectos', origen: '   ', destino: 'Sitio', diasViaje: [MANANA] },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudPasaje.errors.origenRequerido });
  });

  it('destino vacío → error', () => {
    const result = validatePasajeRequestInput(
      { motivoViaje: 'traslado_proyectos', origen: 'Base', destino: '', diasViaje: [MANANA] },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudPasaje.errors.destinoRequerido });
  });

  it('dias_viaje vacío → error', () => {
    const result = validatePasajeRequestInput(
      { motivoViaje: 'traslado_proyectos', origen: 'Base', destino: 'Sitio', diasViaje: [] },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudPasaje.errors.diasRequeridos });
  });

  it('un día = hoy → válida (hoy permitido, no es retroactivo)', () => {
    const result = validatePasajeRequestInput(
      { motivoViaje: 'traslado_proyectos', origen: 'Base', destino: 'Sitio', diasViaje: [HOY, MANANA] },
      HOY
    );
    expect(result).toEqual({ valid: true });
  });

  it('un solo día anterior a hoy entre varios días válidos → error de retroactiva', () => {
    const result = validatePasajeRequestInput(
      { motivoViaje: 'traslado_proyectos', origen: 'Base', destino: 'Sitio', diasViaje: [MANANA, '2020-01-01'] },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudPasaje.errors.diaRetroactivo });
  });

  it('todos los días futuros o iguales a hoy → válida', () => {
    const result = validatePasajeRequestInput(
      {
        motivoViaje: 'traslado_proyectos',
        origen: 'Base',
        destino: 'Sitio',
        diasViaje: [MANANA, PASADO_MANANA],
      },
      HOY
    );
    expect(result).toEqual({ valid: true });
  });
});

// ─── SolicitudPasajePage: branch por rol ───────────────────────────────────

describe('SolicitudPasajePage: branch por rol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockPageQueries(opts: {
    team?: unknown[];
    teamError?: unknown;
    requests?: unknown[];
    requestsError?: unknown;
  }) {
    const { team = [], teamError = null, requests = [], requestsError = null } = opts;

    const teamOrderMock = vi.fn().mockResolvedValue({ data: team, error: teamError });
    const teamOrMock = vi.fn().mockReturnValue({ order: teamOrderMock });
    const teamEqMock = vi.fn().mockReturnValue({ or: teamOrMock });
    const teamSelectMock = vi.fn().mockReturnValue({ eq: teamEqMock });

    const requestsOrderMock = vi.fn().mockResolvedValue({ data: requests, error: requestsError });
    const requestsEqMock = vi.fn().mockReturnValue({ order: requestsOrderMock });
    const requestsSelectMock = vi.fn().mockReturnValue({ eq: requestsEqMock });

    const fromMock = vi.fn((table: string) =>
      table === 'profiles' ? { select: teamSelectMock } : { select: requestsSelectMock }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
    return { teamEqMock, teamOrMock, requestsEqMock, requestsOrderMock };
  }

  it('admin: modo consulta, sin formulario de envío', async () => {
    mockProfile('admin');
    mockPageQueries({});

    const result = await SolicitudPasajePage();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).type).toBe(Card);
  });

  it('empleado: recibe el formulario sin selector de equipo y su lista propia filtrada por solicitante_id', async () => {
    mockProfile('empleado', 'emp-1');
    const requests = [{ id: 'p1', solicitante_id: 'emp-1', empleado_id: 'emp-1', estado: 'pendiente' }];
    const { requestsEqMock } = mockPageQueries({ requests });

    const result = await SolicitudPasajePage();

    expect(requestsEqMock).toHaveBeenCalledWith('solicitante_id', 'emp-1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (result as any).props.children as any[];
    const form = children.find((c) => c?.type === SolicitudPasajeForm);
    const table = children.find((c) => c?.type === MisSolicitudesPasajeTable);
    expect(form).toBeTruthy();
    expect(form.props.showEmpleadoSelector).toBe(false);
    expect(form.props.team).toEqual([]);
    expect(table.props.requests).toEqual(requests);
  });

  it('supervisor: recibe el formulario CON selector de equipo (self + su equipo) y su lista propia', async () => {
    mockProfile('supervisor', 'sup-1');
    const team = [{ id: 'sup-1', full_name: 'Supervisor Test', email: 'sup@test.com' }];
    const { teamEqMock, teamOrMock, requestsEqMock } = mockPageQueries({ team });

    const result = await SolicitudPasajePage();

    expect(teamEqMock).toHaveBeenCalledWith('status', 'activo');
    expect(teamOrMock).toHaveBeenCalledWith('id.eq.sup-1,supervisor_id.eq.sup-1');
    expect(requestsEqMock).toHaveBeenCalledWith('solicitante_id', 'sup-1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (result as any).props.children as any[];
    const form = children.find((c) => c?.type === SolicitudPasajeForm);
    expect(form.props.showEmpleadoSelector).toBe(true);
    expect(form.props.team).toEqual(team);
  });
});
