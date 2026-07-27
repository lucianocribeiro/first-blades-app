/**
 * FB-F4-06 — AprobacionesPage: contrato de estado de la previsualización de
 * sobrescritura ({status:'ok', days} | {status:'error'}).
 *
 * Antes (FB-F4-05), un fallo en la query de rotation_assignments para la
 * previsualización de UN request degradaba silenciosamente a "sin días a
 * sobrescribir" — el mismo resultado que un rango legítimamente libre. Este
 * archivo fija el contrato que distingue ambos casos.
 *
 * Mismo patrón de mocking que aprobaciones-page-saldo.test.ts: mockea
 * @/lib/auth y @/lib/supabase/server, invoca AprobacionesPage() directo (es
 * un server component async) e inspecciona las props que llegan a
 * AprobacionesTable (que usa useState, así que nunca se invoca/renderiza acá).
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

function ausenciaRow(id: string, userId: string) {
  return {
    id,
    user_id: userId,
    estado: 'pendiente',
    motivo_ausencia: 'vacaciones',
    fecha_inicio: '2027-03-15',
    fecha_fin: '2027-03-17',
    created_at: '2027-03-01T00:00:00Z',
  };
}

// page.tsx consulta rotation_assignments dos veces: primero el saldo (una
// sola query .in()+.eq()+.gte()+.lte(), awaited antes de seguir), después una
// query de previsualización por cada ausencia pendiente (.eq()+.gte()+.lte(),
// sin .in()), disparadas en Promise.all pero construidas sincrónicamente en
// orden dentro del .map() (antes del primer await de cada una). Un contador
// de llamadas alcanza para dirigir cada .from('rotation_assignments') a su
// builder correspondiente, sin ambigüedad de orden.
function mockQueries(opts: {
  documents?: unknown[];
  ausencias?: Array<{ id: string; user_id: string }>;
  saldoResult?: { data: unknown[] | null; error: unknown };
  overwriteResults?: Array<{ data: unknown[] | null; error: unknown }>;
}) {
  const {
    documents = [],
    ausencias = [],
    saldoResult = { data: [], error: null },
    overwriteResults = [],
  } = opts;

  const docsBuilder = makeBuilder(['select', 'eq'], 'order', { data: documents, error: null });
  const ausenciasBuilder = makeBuilder(['select', 'eq'], 'order', { data: ausencias, error: null });
  const saldoBuilder = makeBuilder(['select', 'in', 'eq', 'gte'], 'lte', saldoResult);

  const solicitanteIds = [...new Set(ausencias.map((a) => a.user_id))];
  let rotationCallIndex = 0;
  let overwriteCallIndex = 0;

  const from = vi.fn((table: string) => {
    if (table === 'documents') return docsBuilder;
    if (table === 'ausencia_requests') return ausenciasBuilder;
    rotationCallIndex++;
    if (rotationCallIndex === 1 && solicitanteIds.length > 0) return saldoBuilder;
    const result = overwriteResults[overwriteCallIndex] ?? { data: [], error: null };
    overwriteCallIndex++;
    return makeBuilder(['select', 'eq', 'gte'], 'lte', result);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from } as any);
  return { docsBuilder, ausenciasBuilder, saldoBuilder, from };
}

describe('AprobacionesPage: previsualización de sobrescritura (FB-F4-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'admin' } as any);
  });

  it('fallo simulado de la query → status:"error" para ESE request, distinguible de "sin días"', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ausencias = [ausenciaRow('req-1', 'emp-1')];
    mockQueries({
      ausencias,
      overwriteResults: [{ data: null, error: { message: 'db error' } }],
    });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({
      'req-1': { status: 'error' },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AprobacionesPage]'),
      expect.any(String)
    );
    // El fallo puntual de la previsualización no rompe la cola ni el resto
    // de la página — la aprobación/rechazo sigue disponible (no bloqueante).
    expect(table?.props?.items).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('éxito con días (incl. es_estimado=true) → status:"ok" con los días', async () => {
    const ausencias = [ausenciaRow('req-1', 'emp-1')];
    const dias = [
      { fecha: '2027-03-16', estado_dia: 'periodo_fuera_trabajo', es_estimado: false },
      { fecha: '2027-03-17', estado_dia: 'trabajando', es_estimado: true },
    ];
    mockQueries({
      ausencias,
      overwriteResults: [{ data: dias, error: null }],
    });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({
      'req-1': { status: 'ok', days: dias },
    });
  });

  it('éxito sin días (rango totalmente libre) → status:"ok" con days=[], sin aviso', async () => {
    const ausencias = [ausenciaRow('req-1', 'emp-1')];
    mockQueries({
      ausencias,
      overwriteResults: [{ data: [], error: null }],
    });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({
      'req-1': { status: 'ok', days: [] },
    });
  });

  it('múltiples ausencias pendientes: cada una resuelve su propio status de forma independiente', async () => {
    const ausencias = [ausenciaRow('req-1', 'emp-1'), ausenciaRow('req-2', 'emp-2')];
    mockQueries({
      ausencias,
      overwriteResults: [
        { data: null, error: { message: 'db error' } },
        { data: [{ fecha: '2027-03-16', estado_dia: 'trabajando', es_estimado: false }], error: null },
      ],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({
      'req-1': { status: 'error' },
      'req-2': { status: 'ok', days: [{ fecha: '2027-03-16', estado_dia: 'trabajando', es_estimado: false }] },
    });
  });

  it('sin ausencias pendientes: overwriteStatusByRequest queda vacío, no rompe', async () => {
    mockQueries({ ausencias: [] });

    const result = await AprobacionesPage();
    const table = findElement(result, AprobacionesTable);

    expect(table?.props?.overwriteStatusByRequest).toEqual({});
  });
});
