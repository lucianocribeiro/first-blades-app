/**
 * FB-F4-10 — AprobacionesPage: la bandeja única suma pasajes pendientes
 * (junto a documentos y ausencias, sin acotarlos), con su propia
 * previsualización de sobrescritura sobre dias_viaje (fechas discretas, no
 * un rango) en el calendario del empleado_id (quien viaja).
 *
 * Mismo patrón de mocking que aprobaciones-page-overwrite.test.ts: mockea
 * @/lib/auth y @/lib/supabase/server, invoca AprobacionesPage() directo e
 * inspecciona las props que llegan a AprobacionesTable.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import AprobacionesPage from '@/app/(app)/aprobaciones/page';
import { AprobacionesTable } from '@/app/(app)/aprobaciones/AprobacionesTable';

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

function findElement(node: unknown, type: unknown): ElementLike | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findElement(n, type);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object') return undefined;
  const el = node as ElementLike;
  if (el.type === type) return el;
  if (el.type === AprobacionesTable) return undefined;
  if (typeof el.type === 'function') {
    const rendered = (el.type as (props: unknown) => unknown)(el.props);
    return findElement(rendered, type);
  }
  return findElement((el.props as { children?: unknown } | undefined)?.children, type);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(methods: string[], finalMethod: string, result: { data: unknown[] | null; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of methods) builder[m] = vi.fn().mockReturnValue(builder);
  builder[finalMethod] = vi.fn().mockResolvedValue(result);
  return builder;
}

function pasajeRow(id: string, opts: { solicitanteId?: string; empleadoId: string; diasViaje: string[] | null }) {
  return {
    id,
    solicitante_id: opts.solicitanteId ?? opts.empleadoId,
    empleado_id: opts.empleadoId,
    estado: 'pendiente',
    motivo_viaje: 'traslado_proyectos',
    origen: 'Base',
    destino: 'Sitio',
    dias_viaje: opts.diasViaje,
    created_at: '2027-03-01T00:00:00Z',
  };
}

// Sin ausencias en estos tests (solicitanteIds queda vacío) — la query de
// saldo no corre, así que las únicas llamadas a rotation_assignments son las
// de previsualización de pasaje (.in(), no .gte()/.lte()), en el mismo orden
// que pasajesRaw.
function mockQueries(opts: {
  pasajes?: ReturnType<typeof pasajeRow>[];
  overwriteResults?: Array<{ data: unknown[] | null; error: unknown }>;
}) {
  const { pasajes = [], overwriteResults = [] } = opts;

  const docsBuilder = makeBuilder(['select', 'eq'], 'order', { data: [], error: null });
  const ausenciasBuilder = makeBuilder(['select', 'eq'], 'order', { data: [], error: null });
  const pasajesBuilder = makeBuilder(['select', 'eq'], 'order', { data: pasajes, error: null });

  let overwriteCallIndex = 0;
  const from = vi.fn((table: string) => {
    if (table === 'documents') return docsBuilder;
    if (table === 'ausencia_requests') return ausenciasBuilder;
    if (table === 'pasaje_requests') return pasajesBuilder;
    const result = overwriteResults[overwriteCallIndex] ?? { data: [], error: null };
    overwriteCallIndex++;
    return makeBuilder(['select', 'eq'], 'in', result);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from } as any);
  return { docsBuilder, ausenciasBuilder, pasajesBuilder, from };
}

describe('AprobacionesPage: cola incluye pasajes pendientes (FB-F4-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'admin' } as any);
  });

  it('un pasaje pendiente con dias_viaje vacío/NULL: aparece en items, sin disparar query de previsualización', async () => {
    const pasajes = [pasajeRow('req-1', { empleadoId: 'emp-1', diasViaje: null })];
    const { from } = mockQueries({ pasajes });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.items).toEqual([{ kind: 'pasaje', data: pasajes[0] }]);
    expect(table?.props?.overwriteStatusByRequest).toEqual({ 'req-1': { status: 'ok', days: [] } });
    // Ninguna llamada extra a rotation_assignments (solo documents/ausencia/pasaje_requests).
    expect(from).toHaveBeenCalledTimes(3);
  });

  it('previsualización de pasaje: consulta el calendario del EMPLEADO (quien viaja), filtrando por dias_viaje discretos', async () => {
    const pasajes = [
      pasajeRow('req-1', { solicitanteId: 'sup-1', empleadoId: 'emp-1', diasViaje: ['2027-07-01', '2027-07-02'] }),
    ];
    const dias = [
      { fecha: '2027-07-01', estado_dia: 'trabajando', es_estimado: false },
      { fecha: '2027-07-02', estado_dia: 'periodo_fuera_trabajo', es_estimado: true },
    ];
    const { pasajesBuilder } = mockQueries({ pasajes, overwriteResults: [{ data: dias, error: null }] });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(pasajesBuilder.eq).toHaveBeenCalledWith('estado', 'pendiente');
    expect(table?.props?.overwriteStatusByRequest).toEqual({
      'req-1': { status: 'ok', days: dias },
    });
  });

  it('rango totalmente libre → status ok con days=[]', async () => {
    const pasajes = [pasajeRow('req-1', { empleadoId: 'emp-1', diasViaje: ['2027-07-10'] })];
    mockQueries({ pasajes, overwriteResults: [{ data: [], error: null }] });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({ 'req-1': { status: 'ok', days: [] } });
  });

  it('fallo en la query de previsualización → status:error, distinguible de "sin días", no rompe la cola', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pasajes = [pasajeRow('req-1', { empleadoId: 'emp-1', diasViaje: ['2027-07-10'] })];
    mockQueries({ pasajes, overwriteResults: [{ data: null, error: { message: 'db error' } }] });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({ 'req-1': { status: 'error' } });
    expect(table?.props?.items).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AprobacionesPage]'),
      expect.any(String)
    );
    errorSpy.mockRestore();
  });

  it('múltiples pasajes pendientes: cada uno resuelve su propio status de forma independiente', async () => {
    const pasajes = [
      pasajeRow('req-1', { empleadoId: 'emp-1', diasViaje: ['2027-07-10'] }),
      pasajeRow('req-2', { empleadoId: 'emp-2', diasViaje: ['2027-07-11'] }),
    ];
    mockQueries({
      pasajes,
      overwriteResults: [
        { data: null, error: { message: 'db error' } },
        { data: [{ fecha: '2027-07-11', estado_dia: 'trabajando', es_estimado: false }], error: null },
      ],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({
      'req-1': { status: 'error' },
      'req-2': { status: 'ok', days: [{ fecha: '2027-07-11', estado_dia: 'trabajando', es_estimado: false }] },
    });
  });
});
