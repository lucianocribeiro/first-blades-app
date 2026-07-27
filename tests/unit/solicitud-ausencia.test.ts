/**
 * Solicitud de Ausencia — formulario unificado multi-motivo (FB-F4-05,
 * generaliza FB-F3-16 día de trámite).
 *
 * Mockea @/lib/auth (requireAuth) y @/lib/supabase/server (createServerClient)
 * para ejercitar la server action y la page real sin tocar la base, siguiendo
 * el mismo patrón que tests/unit/calendario-server-boundary.test.ts.
 *
 * Las invariantes de RLS (INSERT propio forzado a pendiente, scope de "mis
 * solicitudes" por rol, rechazo de la exclusion constraint
 * ausencia_requests_no_solapamiento_pendiente para cualquier motivo) ya están
 * cubiertas a nivel de base en tests/integration/rls.test.ts y
 * tests/integration/ausencia-no-solapamiento.test.ts (FB-F4-01/02, genérico
 * por diseño); acá se testea que el código de la app arma el payload
 * correcto para cualquier motivo, valida el rango y la no-retroactiva
 * server-side, nunca deja pasar un estado/user_id distinto, y traduce el
 * choque de la exclusion constraint a copy amigable en vez de propagar el
 * error crudo o tragarlo silenciosamente.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { createAusenciaRequest } from '@/app/(app)/solicitud-ausencia/actions';
import {
  translateAusenciaInsertError,
  validateAusenciaRequestInput,
} from '@/app/(app)/solicitud-ausencia/logic';
import SolicitudAusenciaPage from '@/app/(app)/solicitud-ausencia/page';
import { SolicitudAusenciaForm } from '@/app/(app)/solicitud-ausencia/SolicitudAusenciaForm';
import { MisSolicitudesTable } from '@/app/(app)/solicitud-ausencia/MisSolicitudesTable';
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

function mockSupabaseInsert(error: { code?: string; message: string } | null = null) {
  const insertMock = vi.fn().mockResolvedValue({ error });
  const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { insertMock, fromMock };
}

// Mockea AMBAS queries que arma page.tsx: la de "mis solicitudes"
// (ausencia_requests) y la del saldo de días de trámite (rotation_assignments,
// FB-F3-21). Rutea por nombre de tabla — cada una tiene una forma de cadena
// distinta (.eq().order() vs .eq().eq().gte().lte()).
function mockSupabaseSelect(
  ausenciaResult: { data: unknown[] | null; error: { message: string } | null },
  saldoResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null }
) {
  const orderMock = vi.fn().mockResolvedValue(ausenciaResult);
  const eqMock = vi.fn().mockReturnValue({ order: orderMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });

  const saldoLteMock = vi.fn().mockResolvedValue(saldoResult);
  const saldoGteMock = vi.fn().mockReturnValue({ lte: saldoLteMock });
  const saldoEqMotivoMock = vi.fn().mockReturnValue({ gte: saldoGteMock });
  const saldoEqUserMock = vi.fn().mockReturnValue({ eq: saldoEqMotivoMock });
  const saldoSelectMock = vi.fn().mockReturnValue({ eq: saldoEqUserMock });

  const fromMock = vi.fn((table: string) =>
    table === 'ausencia_requests' ? { select: selectMock } : { select: saldoSelectMock }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { orderMock, eqMock, selectMock, fromMock, saldoEqUserMock, saldoEqMotivoMock, saldoGteMock, saldoLteMock };
}

// Fecha fija "hoy" usada en todo el archivo para que las aserciones de
// no-retroactiva no dependan de cuándo corre el test.
const HOY = '2027-06-15';
const AYER = '2027-06-14';
const MANANA = '2027-06-16';

// ─── createAusenciaRequest: gating, validación y payload (FB-F4-05) ───────

describe('createAusenciaRequest: gating e integridad del purgatorio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: rechazado antes de llamar insert (modo consulta, no envía)', async () => {
    mockProfile('admin');
    const { insertMock } = mockSupabaseInsert();

    await expect(
      createAusenciaRequest({ motivo: 'dia_tramite', fechaInicio: MANANA, fechaFin: MANANA })
    ).rejects.toThrow(copy.errors.unauthorized);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: sin motivo rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createAusenciaRequest({ motivo: '' as any, fechaInicio: MANANA, fechaFin: MANANA })
    ).rejects.toThrow(copy.solicitudAusencia.errors.motivoRequerido);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: sin fechas rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();

    await expect(
      createAusenciaRequest({ motivo: 'vacaciones', fechaInicio: '', fechaFin: '' })
    ).rejects.toThrow(copy.solicitudAusencia.errors.fechaRequerida);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: fecha_fin anterior a fecha_inicio rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();

    await expect(
      createAusenciaRequest({ motivo: 'vacaciones', fechaInicio: '2027-07-10', fechaFin: '2027-07-05' })
    ).rejects.toThrow(copy.solicitudAusencia.errors.fechaFinAnteriorAInicio);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: fecha_inicio retroactiva (antes de hoy) rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const ayerIso = ayer.toISOString().slice(0, 10);

    await expect(
      createAusenciaRequest({ motivo: 'vacaciones', fechaInicio: ayerIso, fechaFin: ayerIso })
    ).rejects.toThrow(copy.solicitudAusencia.errors.fechaRetroactiva);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("empleado: motivo 'otros' sin motivo_otros_texto rechaza antes de llamar insert", async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();

    await expect(
      createAusenciaRequest({ motivo: 'otros', fechaInicio: MANANA, fechaFin: MANANA })
    ).rejects.toThrow(copy.solicitudAusencia.errors.motivoOtrosRequerido);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("empleado: motivo 'otros' con motivo_otros_texto de más de 80 caracteres rechaza antes de llamar insert", async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();

    await expect(
      createAusenciaRequest({
        motivo: 'otros',
        fechaInicio: MANANA,
        fechaFin: MANANA,
        motivoOtrosTexto: 'x'.repeat(81),
      })
    ).rejects.toThrow(copy.solicitudAusencia.errors.motivoOtrosMaximo);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: inserta con user_id propio, motivo dia_tramite y fecha_inicio=fecha_fin (regresión FB-F3-16)', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock, fromMock } = mockSupabaseInsert();

    await createAusenciaRequest({
      motivo: 'dia_tramite',
      fechaInicio: MANANA,
      fechaFin: MANANA,
      nota: '  Trámite en el banco  ',
    });

    expect(fromMock).toHaveBeenCalledWith('ausencia_requests');
    expect(insertMock).toHaveBeenCalledWith([{
      user_id: 'emp-1',
      motivo_ausencia: 'dia_tramite',
      motivo_otros_texto: null,
      fecha_inicio: MANANA,
      fecha_fin: MANANA,
      notas: 'Trámite en el banco',
      estado: 'pendiente',
    }]);
    expect(revalidatePath).toHaveBeenCalledWith('/solicitud-ausencia');
  });

  it('empleado: inserta un rango multi-día (vacaciones) con fecha_inicio distinta de fecha_fin', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseInsert();

    await createAusenciaRequest({ motivo: 'vacaciones', fechaInicio: '2027-07-01', fechaFin: '2027-07-05' });

    expect(insertMock).toHaveBeenCalledWith([expect.objectContaining({
      motivo_ausencia: 'vacaciones',
      motivo_otros_texto: null,
      fecha_inicio: '2027-07-01',
      fecha_fin: '2027-07-05',
    })]);
  });

  it("empleado: motivo 'otros' persiste motivo_otros_texto trimeado", async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseInsert();

    await createAusenciaRequest({
      motivo: 'otros',
      fechaInicio: MANANA,
      fechaFin: MANANA,
      motivoOtrosTexto: '  Trámite médico personal  ',
    });

    expect(insertMock).toHaveBeenCalledWith([expect.objectContaining({
      motivo_ausencia: 'otros',
      motivo_otros_texto: 'Trámite médico personal',
    })]);
  });

  it("un motivo distinto de 'otros' nunca persiste motivo_otros_texto, aunque el input lo traiga", async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseInsert();

    await createAusenciaRequest({
      motivo: 'vacaciones',
      fechaInicio: MANANA,
      fechaFin: MANANA,
      motivoOtrosTexto: 'no debería guardarse',
    });

    expect(insertMock).toHaveBeenCalledWith([expect.objectContaining({ motivo_otros_texto: null })]);
  });

  it('empleado: nota vacía o solo espacios se guarda como null, no como string vacío', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseInsert();

    await createAusenciaRequest({ motivo: 'dia_tramite', fechaInicio: MANANA, fechaFin: MANANA, nota: '   ' });

    expect(insertMock).toHaveBeenCalledWith([expect.objectContaining({ notas: null })]);
  });

  it('supervisor: también puede insertar para sí mismo (misma policy no-admin que empleado)', async () => {
    mockProfile('supervisor', 'sup-1');
    const { insertMock } = mockSupabaseInsert();

    await createAusenciaRequest({ motivo: 'dia_tramite', fechaInicio: MANANA, fechaFin: MANANA });

    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'sup-1', estado: 'pendiente', motivo_ausencia: 'dia_tramite' }),
    ]);
  });

  it('choque con la exclusion constraint de no-solapamiento (23P01) se traduce a copy amigable, no al error crudo — cualquier motivo', async () => {
    mockProfile('empleado', 'emp-1');
    mockSupabaseInsert({
      code: '23P01',
      message: 'conflicting key value violates exclusion constraint "ausencia_requests_no_solapamiento_pendiente"',
    });

    await expect(
      createAusenciaRequest({ motivo: 'licencia_medica', fechaInicio: MANANA, fechaFin: MANANA })
    ).rejects.toThrow(copy.solicitudAusencia.errors.pendienteDuplicada);
  });

  it('otros errores de Supabase se traducen al genérico es-AR, nunca se tragan ni muestran crudos', async () => {
    mockProfile('empleado', 'emp-1');
    mockSupabaseInsert({ message: 'internal db error xyz' });

    await expect(
      createAusenciaRequest({ motivo: 'dia_tramite', fechaInicio: MANANA, fechaFin: MANANA })
    ).rejects.toThrow(copy.errors.generic);
  });
});

// ─── validateAusenciaRequestInput (unidad pura) ────────────────────────────

describe('validateAusenciaRequestInput: no-retroactiva, rango y motivo otros', () => {
  it('motivo vacío → error', () => {
    const result = validateAusenciaRequestInput(
      { motivo: '', fechaInicio: MANANA, fechaFin: MANANA },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.motivoRequerido });
  });

  it('fechaInicio o fechaFin vacías → error', () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'vacaciones', fechaInicio: '', fechaFin: MANANA },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.fechaRequerida });
  });

  it('fechaFin anterior a fechaInicio → error', () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'vacaciones', fechaInicio: '2027-07-10', fechaFin: '2027-07-05' },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.fechaFinAnteriorAInicio });
  });

  it('fechaInicio = hoy → válida (hoy permitido, no es retroactiva)', () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'vacaciones', fechaInicio: HOY, fechaFin: HOY },
      HOY
    );
    expect(result).toEqual({ valid: true });
  });

  it('fechaInicio anterior a hoy → error de retroactiva', () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'vacaciones', fechaInicio: AYER, fechaFin: AYER },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.fechaRetroactiva });
  });

  it("motivo 'otros' sin motivo_otros_texto → error", () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'otros', fechaInicio: MANANA, fechaFin: MANANA },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.motivoOtrosRequerido });
  });

  it("motivo 'otros' con solo espacios en motivo_otros_texto → error (no cuenta como completado)", () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'otros', fechaInicio: MANANA, fechaFin: MANANA, motivoOtrosTexto: '   ' },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.motivoOtrosRequerido });
  });

  it("motivo 'otros' con motivo_otros_texto de 81 caracteres → error de máximo", () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'otros', fechaInicio: MANANA, fechaFin: MANANA, motivoOtrosTexto: 'x'.repeat(81) },
      HOY
    );
    expect(result).toEqual({ valid: false, error: copy.solicitudAusencia.errors.motivoOtrosMaximo });
  });

  it("motivo 'otros' con motivo_otros_texto válido (≤80) → válida", () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'otros', fechaInicio: MANANA, fechaFin: MANANA, motivoOtrosTexto: 'Trámite médico' },
      HOY
    );
    expect(result).toEqual({ valid: true });
  });

  it('un motivo distinto de otros no exige motivo_otros_texto', () => {
    const result = validateAusenciaRequestInput(
      { motivo: 'matrimonio', fechaInicio: MANANA, fechaFin: MANANA },
      HOY
    );
    expect(result).toEqual({ valid: true });
  });
});

// ─── translateAusenciaInsertError (unidad pura) ────────────────────────────

describe('translateAusenciaInsertError', () => {
  it('no traduce (devuelve null) errores sin código 23P01, para no tragarlos', () => {
    expect(translateAusenciaInsertError({ code: '23514' })).toBeNull();
    expect(translateAusenciaInsertError(null)).toBeNull();
    expect(translateAusenciaInsertError(undefined)).toBeNull();
  });
});

// ─── SolicitudAusenciaPage: branch por rol ──────────────────────────────────

describe('SolicitudAusenciaPage: branch por rol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: modo consulta, sin formulario de envío', async () => {
    mockProfile('admin');

    const result = await SolicitudAusenciaPage();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).type).toBe(Card);
  });

  it('empleado: recibe el formulario (con su saldo de días de trámite ya calculado) y su lista propia filtrada por user_id explícito', async () => {
    mockProfile('empleado', 'emp-1');
    const rows = [{ id: 'a1', user_id: 'emp-1', estado: 'pendiente' }];
    const diasTramite = [{ user_id: 'emp-1', fecha: '2027-03-01', es_estimado: false }];
    const { eqMock, saldoEqUserMock, saldoEqMotivoMock } = mockSupabaseSelect(
      { data: rows, error: null },
      { data: diasTramite, error: null }
    );

    const result = await SolicitudAusenciaPage();

    expect(eqMock).toHaveBeenCalledWith('user_id', 'emp-1');
    expect(saldoEqUserMock).toHaveBeenCalledWith('user_id', 'emp-1');
    expect(saldoEqMotivoMock).toHaveBeenCalledWith('motivo_ausencia', 'dia_tramite');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (result as any).props.children as any[];
    const form = children.find((c) => c?.type === SolicitudAusenciaForm);
    const table = children.find((c) => c?.type === MisSolicitudesTable);
    expect(form).toBeTruthy();
    expect(table).toBeTruthy();
    expect(table.props.requests).toEqual(rows);
    // El saldo ya no se renderiza como card aparte: se lo pasa al formulario,
    // que decide mostrarlo o no según el motivo elegido (FB-F4-05).
    expect(form.props.saldo).toMatchObject({
      employeeId: 'emp-1',
      consumidos: 1,
      restantes: 2,
      excedido: false,
      fechas: [{ fecha: '2027-03-01', esEstimado: false }],
    });
  });

  it('supervisor: también recibe el formulario + lista propia + saldo propio (no modo consulta)', async () => {
    mockProfile('supervisor', 'sup-1');
    const { eqMock, saldoEqUserMock } = mockSupabaseSelect({ data: [], error: null });

    const result = await SolicitudAusenciaPage();

    expect(eqMock).toHaveBeenCalledWith('user_id', 'sup-1');
    expect(saldoEqUserMock).toHaveBeenCalledWith('user_id', 'sup-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).type).not.toBe(Card);
  });
});

// ─── copy.solicitudAusencia — sin terminología técnica visible ─────────────

const TERMINOS_PROHIBIDOS = ['enum', 'estado:', 'aprobado/rechazado', 'approval_status'];

function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
  return acc;
}

describe('copy.solicitudAusencia — sin terminología técnica visible', () => {
  const strings = collectStrings(copy.solicitudAusencia);

  it.each(TERMINOS_PROHIBIDOS)('ningún string visible contiene "%s"', (termino) => {
    const ofensores = strings.filter((s) => s.toLowerCase().includes(termino));
    expect(ofensores).toEqual([]);
  });

  it('usa la terminología amigable exacta pedida por el PRD', () => {
    expect(copy.solicitudAusencia.formTitle).toBe('Solicitud de Ausencia');
    expect(copy.solicitudAusencia.listTitle).toBe('Mis solicitudes');
    expect(copy.solicitudAusencia.estados.pendiente).toBe('Pendiente');
    expect(copy.solicitudAusencia.estados.aprobado).toBe('Aprobada');
    expect(copy.solicitudAusencia.estados.rechazado).toBe('Rechazada');
    expect(copy.purgatorio.motivo).toBe('Motivo del rechazo');
  });
});
