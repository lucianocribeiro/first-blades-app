/**
 * FB-F3-21 — AprobacionesPage: construcción de la query de saldo y
 * propagación a AprobacionesTable (saldoByUser).
 *
 * Mockea @/lib/auth (requireAdmin) y @/lib/supabase/server (createServerClient)
 * para ejercitar page.tsx sin tocar la base, mismo patrón que
 * tests/unit/calendario-server-boundary.test.ts. AprobacionesTable usa
 * useState, así que no se invoca — se inspeccionan las props que le llegan.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import AprobacionesPage from '@/app/(app)/aprobaciones/page';
import { AprobacionesTable } from '@/app/(app)/aprobaciones/AprobacionesTable';

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

// Mismo criterio que tests/unit/calendario-server-boundary.test.ts:
// AprobacionesTable usa useState, así que nunca se invoca — se corta ahí.
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

function mockQueries(opts: {
  documents?: unknown[];
  ausencias?: unknown[];
  diasTramite?: unknown[];
}) {
  const { documents = [], ausencias = [], diasTramite = [] } = opts;

  const docsBuilder = makeBuilder(['select', 'eq'], 'order', { data: documents, error: null });
  const ausenciasBuilder = makeBuilder(['select', 'eq'], 'order', { data: ausencias, error: null });
  const saldoBuilder = makeBuilder(['select', 'in', 'eq', 'gte'], 'lte', { data: diasTramite, error: null });

  const from = vi.fn((table: string) => {
    if (table === 'documents') return docsBuilder;
    if (table === 'ausencia_requests') return ausenciasBuilder;
    return saldoBuilder;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from } as any);
  return { docsBuilder, ausenciasBuilder, saldoBuilder, from };
}

describe('AprobacionesPage: saldoByUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'admin' } as any);
  });

  it('sin ausencias pendientes: no corre la query de saldo (solicitanteIds vacío)', async () => {
    const { saldoBuilder } = mockQueries({ documents: [], ausencias: [] });

    const result = await AprobacionesPage();

    expect(saldoBuilder.select).not.toHaveBeenCalled();
    const table = findElement(result, AprobacionesTable);
    expect(table?.props?.saldoByUser).toEqual({});
  });

  it('con ausencias pendientes: consulta rotation_assignments acotada a los solicitantes únicos + dia_tramite, y arma saldoByUser', async () => {
    const ausencias = [
      { id: 'req-1', user_id: 'emp-1', estado: 'pendiente', motivo_ausencia: 'dia_tramite', created_at: '2027-01-01T00:00:00Z' },
      { id: 'req-2', user_id: 'emp-1', estado: 'pendiente', motivo_ausencia: 'dia_tramite', created_at: '2027-01-02T00:00:00Z' },
      { id: 'req-3', user_id: 'emp-2', estado: 'pendiente', motivo_ausencia: 'dia_tramite', created_at: '2027-01-03T00:00:00Z' },
    ];
    const diasTramite = [
      { user_id: 'emp-1', fecha: '2027-02-01', es_estimado: false },
      { user_id: 'emp-1', fecha: '2027-03-01', es_estimado: false },
    ];
    const { saldoBuilder } = mockQueries({ documents: [], ausencias, diasTramite });

    const result = await AprobacionesPage();

    // Solicitantes únicos (emp-1 aparece dos veces en `ausencias`, una sola vez acá).
    expect(saldoBuilder.in).toHaveBeenCalledWith('user_id', ['emp-1', 'emp-2']);
    expect(saldoBuilder.eq).toHaveBeenCalledWith('motivo_ausencia', 'dia_tramite');

    const table = findElement(result, AprobacionesTable);
    expect(table?.props?.saldoByUser).toEqual({
      'emp-1': expect.objectContaining({ consumidos: 2, restantes: 1, excedido: false }),
      'emp-2': expect.objectContaining({ consumidos: 0, restantes: 3, excedido: false }),
    });
  });

  it('error al cargar el saldo: se señaliza como saldoLoadFailed=true (FB-F3-22), no bloquea la cola, logueado', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ausencias = [
      { id: 'req-1', user_id: 'emp-1', estado: 'pendiente', motivo_ausencia: 'dia_tramite', created_at: '2027-01-01T00:00:00Z' },
    ];
    const { saldoBuilder } = mockQueries({ documents: [], ausencias });
    saldoBuilder.lte = vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } });

    const result = await AprobacionesPage();

    const table = findElement(result, AprobacionesTable);
    expect(table?.props?.saldoByUser).toEqual({});
    // FB-F3-22: la ausencia de badge NO se presenta como "sin días
    // consumidos" (dato válido) — se señaliza explícitamente como falla.
    expect(table?.props?.saldoLoadFailed).toBe(true);
    // La cola sigue renderizando (no es el error genérico de página completa).
    expect(table?.props?.items).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AprobacionesPage]'),
      expect.any(String)
    );
    errorSpy.mockRestore();
  });

  it('saldo cargado OK: saldoLoadFailed=false — regresión', async () => {
    const ausencias = [
      { id: 'req-1', user_id: 'emp-1', estado: 'pendiente', motivo_ausencia: 'dia_tramite', created_at: '2027-01-01T00:00:00Z' },
    ];
    mockQueries({ documents: [], ausencias, diasTramite: [] });

    const result = await AprobacionesPage();

    const table = findElement(result, AprobacionesTable);
    expect(table?.props?.saldoLoadFailed).toBe(false);
  });
});
