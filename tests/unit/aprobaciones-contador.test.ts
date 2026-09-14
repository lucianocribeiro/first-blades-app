/**
 * FB-PI-01 — contarAprobacionesPendientes (lib/aprobaciones.ts): el número del
 * badge de la campanita del admin.
 *
 * A diferencia de los tests de la página que mockean builders encadenados con
 * resultados fijos, acá el cliente Supabase es una base EN MEMORIA que aplica
 * de verdad los filtros (.eq/.in/.gte/.lte) y `{ count, head }`. Así "ignora
 * aprobado y rechazado" y la coincidencia con la bandeja se prueban sobre el
 * efecto (qué filas quedan), no sobre qué métodos se llamaron.
 *
 * Criterio principal: sobre el MISMO set de datos, el helper devuelve la misma
 * cantidad de filas que AprobacionesPage le pasa a la tabla.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { contarAprobacionesPendientes, TABLAS_APROBACION } from '@/lib/aprobaciones';
import AprobacionesPage from '@/app/(app)/aprobaciones/page';
import { AprobacionesTable, type PendingItem } from '@/app/(app)/aprobaciones/AprobacionesTable';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

// ─── Base en memoria con la forma mínima de postgrest-js que usa el código ───

function fakeSupabase(db: Db, failingTables: string[] = []) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let head = false;
      let wantsCount = false;

      const resolve = () => {
        if (failingTables.includes(table)) {
          return { data: null, count: null, error: { message: `fallo simulado en ${table}` } };
        }
        const rows = (db[table] ?? []).filter((row) => filters.every((f) => f(row)));
        return {
          data: head ? null : rows,
          count: wantsCount ? rows.length : null,
          error: null,
        };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          wantsCount = options?.count === 'exact';
          head = options?.head === true;
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push((row) => row[col] === value);
          return builder;
        },
        in(col: string, values: unknown[]) {
          filters.push((row) => values.includes(row[col]));
          return builder;
        },
        gte(col: string, value: string) {
          filters.push((row) => String(row[col]) >= value);
          return builder;
        },
        lte(col: string, value: string) {
          filters.push((row) => String(row[col]) <= value);
          return builder;
        },
        order() {
          return builder;
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(resolve()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (fake: ReturnType<typeof fakeSupabase>) => fake as any;

// ─── Datos ───────────────────────────────────────────────────

let seq = 0;
const created = () => `2027-01-${String(++seq).padStart(2, '0')}T00:00:00Z`;

function doc(estado: string): Row {
  return { id: `doc-${++seq}`, user_id: 'emp-1', estado, document_type: 'dni', created_at: created() };
}
function ausencia(estado: string, motivo = 'vacaciones'): Row {
  return {
    id: `aus-${++seq}`,
    user_id: 'emp-1',
    estado,
    motivo_ausencia: motivo,
    fecha_inicio: '2027-03-01',
    fecha_fin: '2027-03-02',
    created_at: created(),
  };
}
function pasaje(estado: string): Row {
  return {
    id: `pas-${++seq}`,
    solicitante_id: 'emp-1',
    empleado_id: 'emp-1',
    estado,
    motivo_viaje: 'traslado_proyectos',
    dias_viaje: ['2027-04-01'],
    created_at: created(),
  };
}

// Set mixto: pendientes de las tres fuentes (ausencias de varios motivos) +
// resueltas que NO deben contar.
function datasetMixto(): Db {
  return {
    documents: [doc('pendiente'), doc('pendiente'), doc('aprobado'), doc('rechazado')],
    ausencia_requests: [
      ausencia('pendiente', 'vacaciones'),
      ausencia('pendiente', 'dia_tramite'),
      ausencia('pendiente', 'licencia_medica'),
      ausencia('aprobado', 'vacaciones'),
      ausencia('rechazado', 'otros'),
    ],
    pasaje_requests: [pasaje('pendiente'), pasaje('aprobado'), pasaje('rechazado')],
    rotation_assignments: [],
  };
}

// ─── Helper ──────────────────────────────────────────────────

describe('contarAprobacionesPendientes', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('suma las tres fuentes (documentos + ausencias + pasajes)', async () => {
    const db: Db = {
      documents: [doc('pendiente')],
      ausencia_requests: [ausencia('pendiente'), ausencia('pendiente')],
      pasaje_requests: [pasaje('pendiente'), pasaje('pendiente'), pasaje('pendiente')],
    };
    expect(await contarAprobacionesPendientes(asClient(fakeSupabase(db)))).toBe(6);
  });

  it('ignora aprobado y rechazado', async () => {
    // 2 docs + 3 ausencias + 1 pasaje pendientes; el resto resueltas.
    expect(await contarAprobacionesPendientes(asClient(fakeSupabase(datasetMixto())))).toBe(6);
  });

  it('devuelve 0 cuando no hay nada pendiente', async () => {
    const vacia: Db = { documents: [], ausencia_requests: [], pasaje_requests: [] };
    expect(await contarAprobacionesPendientes(asClient(fakeSupabase(vacia)))).toBe(0);

    const soloResueltas: Db = {
      documents: [doc('aprobado')],
      ausencia_requests: [ausencia('rechazado')],
      pasaje_requests: [pasaje('aprobado')],
    };
    expect(await contarAprobacionesPendientes(asClient(fakeSupabase(soloResueltas)))).toBe(0);
  });

  it('respeta el scope de la bandeja: ausencias de CUALQUIER motivo (FB-F4-05), sin filtro extra', async () => {
    const db: Db = {
      documents: [],
      ausencia_requests: [
        ausencia('pendiente', 'dia_tramite'),
        ausencia('pendiente', 'vacaciones'),
        ausencia('pendiente', 'otros'),
      ],
      pasaje_requests: [],
    };
    expect(await contarAprobacionesPendientes(asClient(fakeSupabase(db)))).toBe(3);
  });

  it('cuenta con head:true + count:exact en las tres tablas (no trae filas)', async () => {
    const fake = fakeSupabase(datasetMixto());
    const from = vi.spyOn(fake, 'from');
    await contarAprobacionesPendientes(asClient(fake));

    expect(from.mock.calls.map(([t]) => t).sort()).toEqual([...TABLAS_APROBACION].sort());
    for (const result of from.mock.results) {
      // El builder resuelve data:null cuando head:true — se afirma el efecto.
      const value = await result.value;
      expect(value.data).toBeNull();
      expect(typeof value.count).toBe('number');
    }
  });

  it.each(TABLAS_APROBACION)(
    'si falla la lectura de %s: loguea y devuelve null (no una suma parcial, no throw)',
    async (tabla) => {
      const result = await contarAprobacionesPendientes(asClient(fakeSupabase(datasetMixto(), [tabla])));
      expect(result).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0].join(' '))).toContain(tabla);
    }
  );
});

// ─── Coincidencia con la bandeja (criterio principal) ─────────

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
  if (typeof el.type === 'function') {
    const rendered = (el.type as (props: unknown) => unknown)(el.props);
    return findElement(rendered, type);
  }
  return findElement((el.props as { children?: unknown } | undefined)?.children, type);
}

async function filasDeLaBandeja(db: Db): Promise<PendingItem[]> {
  vi.mocked(createServerClient).mockResolvedValue(asClient(fakeSupabase(db)));
  const tree = await AprobacionesPage();
  const table = findElement(tree, AprobacionesTable);
  expect(table, 'la bandeja debería renderizar la tabla (sin error de carga)').toBeDefined();
  return table!.props!.items as PendingItem[];
}

describe('coincidencia: badge = filas de la bandeja', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'admin' } as never);
  });

  it.each([
    ['set mixto (pendientes + resueltas, varios motivos)', datasetMixto],
    [
      'sin pendientes',
      (): Db => ({
        documents: [doc('aprobado')],
        ausencia_requests: [ausencia('rechazado')],
        pasaje_requests: [],
        rotation_assignments: [],
      }),
    ],
    [
      'solo una fuente con pendientes',
      (): Db => ({
        documents: [],
        ausencia_requests: [],
        pasaje_requests: [pasaje('pendiente'), pasaje('pendiente'), pasaje('rechazado')],
        rotation_assignments: [],
      }),
    ],
  ])('%s', async (_nombre, build) => {
    const db = build();
    const filas = await filasDeLaBandeja(db);
    const conteo = await contarAprobacionesPendientes(asClient(fakeSupabase(db)));

    expect(conteo).toBe(filas.length);
    // Y cada fila visible es efectivamente una pendiente.
    expect(filas.every((f) => f.data.estado === 'pendiente')).toBe(true);
  });
});
