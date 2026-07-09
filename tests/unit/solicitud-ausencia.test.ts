/**
 * Tests unitarios — Solicitud de día de trámite (FB-F3-16)
 *
 * Mockea @/lib/auth (requireAuth) y @/lib/supabase/server (createServerClient)
 * para ejercitar la server action y la page real sin tocar la base, siguiendo
 * el mismo patrón que tests/unit/calendario-server-boundary.test.ts.
 *
 * Las invariantes de RLS (INSERT propio forzado a pendiente, scope de "mis
 * solicitudes" por rol, rechazo del índice único ausencia_requests_pendiente_unica)
 * ya están cubiertas a nivel de base en tests/integration/rls.test.ts
 * (RLS: ausencia_requests) y tests/integration/ausencia-requests-purgatorio.test.ts
 * (FB-F3-14/15); acá se testea que el código de la app arma el payload
 * correcto, nunca deja pasar un estado/user_id distinto, y traduce el choque
 * del índice único a copy amigable en vez de propagar el error crudo o
 * tragarlo silenciosamente.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { createDiaTramiteRequest } from '@/app/(app)/solicitud-ausencia/actions';
import { translateAusenciaInsertError } from '@/app/(app)/solicitud-ausencia/logic';
import SolicitudAusenciaPage from '@/app/(app)/solicitud-ausencia/page';
import { SolicitudAusenciaForm } from '@/app/(app)/solicitud-ausencia/SolicitudAusenciaForm';
import { MisSolicitudesTable } from '@/app/(app)/solicitud-ausencia/MisSolicitudesTable';
import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';

function mockProfile(role: 'admin' | 'supervisor' | 'empleado', id = 'user-1') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAuth).mockResolvedValue({ id, role } as any);
}

function mockSupabaseInsert(error: { code?: string; message: string } | null = null) {
  const insertMock = vi.fn().mockResolvedValue({ error });
  const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { insertMock, fromMock };
}

function mockSupabaseSelect(result: { data: unknown[] | null; error: { message: string } | null }) {
  const orderMock = vi.fn().mockResolvedValue(result);
  const eqMock = vi.fn().mockReturnValue({ order: orderMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { orderMock, eqMock, selectMock, fromMock };
}

// ─── createDiaTramiteRequest: gating e integridad del purgatorio ───────────

describe('createDiaTramiteRequest: gating e integridad del purgatorio (FB-F3-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: rechazado antes de llamar insert (modo consulta, no envía)', async () => {
    mockProfile('admin');
    const { insertMock } = mockSupabaseInsert();

    await expect(createDiaTramiteRequest({ fecha: '2026-09-05' })).rejects.toThrow(
      copy.errors.unauthorized
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: sin fecha rechaza antes de llamar insert', async () => {
    mockProfile('empleado');
    const { insertMock } = mockSupabaseInsert();

    await expect(createDiaTramiteRequest({ fecha: '' })).rejects.toThrow(
      copy.solicitudAusencia.errors.fechaRequerida
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('empleado: inserta con user_id propio, motivo dia_tramite y estado pendiente forzados', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock, fromMock } = mockSupabaseInsert();

    await createDiaTramiteRequest({ fecha: '2026-09-05', nota: '  Trámite en el banco  ' });

    expect(fromMock).toHaveBeenCalledWith('ausencia_requests');
    expect(insertMock).toHaveBeenCalledWith([{
      user_id: 'emp-1',
      motivo_ausencia: 'dia_tramite',
      fecha_inicio: '2026-09-05',
      fecha_fin: '2026-09-05',
      notas: 'Trámite en el banco',
      estado: 'pendiente',
    }]);
    expect(revalidatePath).toHaveBeenCalledWith('/solicitud-ausencia');
  });

  it('empleado: nota vacía o solo espacios se guarda como null, no como string vacío', async () => {
    mockProfile('empleado', 'emp-1');
    const { insertMock } = mockSupabaseInsert();

    await createDiaTramiteRequest({ fecha: '2026-09-05', nota: '   ' });

    expect(insertMock).toHaveBeenCalledWith([expect.objectContaining({ notas: null })]);
  });

  it('supervisor: también puede insertar para sí mismo (misma policy no-admin que empleado)', async () => {
    mockProfile('supervisor', 'sup-1');
    const { insertMock } = mockSupabaseInsert();

    await createDiaTramiteRequest({ fecha: '2026-09-06' });

    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 'sup-1', estado: 'pendiente', motivo_ausencia: 'dia_tramite' }),
    ]);
  });

  it('choque con el índice único parcial (23505) se traduce a copy amigable, no al error crudo', async () => {
    mockProfile('empleado', 'emp-1');
    mockSupabaseInsert({
      code: '23505',
      message: 'duplicate key value violates unique constraint "ausencia_requests_pendiente_unica"',
    });

    await expect(createDiaTramiteRequest({ fecha: '2026-09-05' })).rejects.toThrow(
      copy.solicitudAusencia.errors.pendienteDuplicada
    );
  });

  it('otros errores de Supabase se traducen al genérico es-AR, nunca se tragan ni muestran crudos', async () => {
    mockProfile('empleado', 'emp-1');
    mockSupabaseInsert({ message: 'internal db error xyz' });

    await expect(createDiaTramiteRequest({ fecha: '2026-09-05' })).rejects.toThrow(copy.errors.generic);
  });
});

// ─── translateAusenciaInsertError (unidad pura) ────────────────────────────

describe('translateAusenciaInsertError', () => {
  it('no traduce (devuelve null) errores sin código 23505, para no tragarlos', () => {
    expect(translateAusenciaInsertError({ code: '23514' })).toBeNull();
    expect(translateAusenciaInsertError(null)).toBeNull();
    expect(translateAusenciaInsertError(undefined)).toBeNull();
  });
});

// ─── SolicitudAusenciaPage: branch por rol ──────────────────────────────────

describe('SolicitudAusenciaPage: branch por rol (FB-F3-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin: modo consulta, sin formulario de envío', async () => {
    mockProfile('admin');

    const result = await SolicitudAusenciaPage();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any).type).toBe(Card);
  });

  it('empleado: recibe el formulario y su lista propia, filtrada por user_id explícito', async () => {
    mockProfile('empleado', 'emp-1');
    const rows = [{ id: 'a1', user_id: 'emp-1', estado: 'pendiente' }];
    const { eqMock } = mockSupabaseSelect({ data: rows, error: null });

    const result = await SolicitudAusenciaPage();

    expect(eqMock).toHaveBeenCalledWith('user_id', 'emp-1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children = (result as any).props.children as any[];
    const form = children.find((c) => c?.type === SolicitudAusenciaForm);
    const table = children.find((c) => c?.type === MisSolicitudesTable);
    expect(form).toBeTruthy();
    expect(table).toBeTruthy();
    expect(table.props.requests).toEqual(rows);
  });

  it('supervisor: también recibe el formulario + lista propia (no modo consulta)', async () => {
    mockProfile('supervisor', 'sup-1');
    const { eqMock } = mockSupabaseSelect({ data: [], error: null });

    const result = await SolicitudAusenciaPage();

    expect(eqMock).toHaveBeenCalledWith('user_id', 'sup-1');
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

describe('copy.solicitudAusencia — sin terminología técnica visible (FB-F3-16)', () => {
  const strings = collectStrings(copy.solicitudAusencia);

  it.each(TERMINOS_PROHIBIDOS)('ningún string visible contiene "%s"', (termino) => {
    const ofensores = strings.filter((s) => s.toLowerCase().includes(termino));
    expect(ofensores).toEqual([]);
  });

  it('usa la terminología amigable exacta pedida por el PRD', () => {
    expect(copy.solicitudAusencia.formTitle).toBe('Solicitar día de trámite');
    expect(copy.solicitudAusencia.listTitle).toBe('Mis solicitudes');
    expect(copy.solicitudAusencia.estados.pendiente).toBe('Pendiente');
    expect(copy.solicitudAusencia.estados.aprobado).toBe('Aprobada');
    expect(copy.solicitudAusencia.estados.rechazado).toBe('Rechazada');
    expect(copy.purgatorio.motivo).toBe('Motivo del rechazo');
  });
});
