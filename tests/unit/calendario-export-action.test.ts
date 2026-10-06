/**
 * FB-PI-04 — Server Action del export del calendario
 * (app/(app)/calendario/export-actions.ts::exportarCalendarioExcel).
 *
 * Límite de rol para los 3 roles con el guard REAL (lib/auth.ts →
 * requireAdmin → requireRole → requireAuth): solo se mockea el cliente de
 * Supabase (sesión + perfil con el rol de cada caso) y redirect(), que acá
 * tira como en producción. Supervisor y empleado cortan por redirect ANTES
 * de cualquier lectura de calendario; admin recibe el archivo.
 *
 * También: validación de rango, paginación (tope de filas de PostgREST),
 * filtro de activos en la query y errores de PostgREST leídos como valor
 * (§2.5) → { ok: false } con copy es-AR, sin tirar.
 *
 * La exclusión real de inactivos y la paginación contra PostgREST de
 * verdad están en tests/integration/calendario-export.test.ts.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

// exceljs declara su propio `Buffer` global (extends ArrayBuffer), que no
// cierra con el Buffer de @types/node: el cast es solo de tipos.
type XlsxInput = Parameters<ExcelJS.Xlsx['load']>[0];

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

const buildFailure = { enabled: false };
vi.mock('@/lib/rotation/calendario-excel', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rotation/calendario-excel')>();
  return {
    ...original,
    buildCalendarioWorkbook: vi.fn((...args: Parameters<typeof original.buildCalendarioWorkbook>) => {
      if (buildFailure.enabled) return Promise.reject(new Error('fallo de exceljs'));
      return original.buildCalendarioWorkbook(...args);
    }),
  };
});

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { exportarCalendarioExcel } from '@/app/(app)/calendario/export-actions';
import { copy } from '@/lib/copy';

type Role = 'admin' | 'supervisor' | 'empleado';
type Result = { data: unknown; error: { message: string } | null };

const EMPLEADOS = [
  { id: 'u-ana', full_name: 'Ana Pérez', email: 'ana@firstblades.test' },
  { id: 'u-beto', full_name: 'Beto Gómez', email: 'beto@firstblades.test' },
];

// Query builder encadenable de PostgREST: registra cada llamada y resuelve
// con `resolve(calls)` cuando se lo awaitea (o con .single()).
function makeQuery(resolve: (calls: [string, unknown[]][]) => Result) {
  const calls: [string, unknown[]][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) {
    q[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return q;
    });
  }
  q.single = vi.fn(() => Promise.resolve(resolve(calls)));
  q.then = (onOk: (r: Result) => unknown, onErr: (e: unknown) => unknown) =>
    Promise.resolve(resolve(calls)).then(onOk, onErr);
  q.calls = calls;
  return q;
}

type ClientOptions = {
  role: Role;
  employees?: Result;
  // Todas las filas de rotation_assignments; el mock las sirve por .range().
  assignments?: unknown[];
  assignmentsError?: { message: string };
  maxRows?: number;
};

function mockClient(opts: ClientOptions) {
  const { role, employees = { data: EMPLEADOS, error: null }, assignments = [], maxRows = 1000 } = opts;
  const queries: Record<string, ReturnType<typeof makeQuery>[]> = { profiles: [], rotation_assignments: [] };

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'session-user' } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn((table: string) => {
      let q;
      if (table === 'profiles') {
        q = makeQuery((calls) => {
          // requireAuth(): select('*').eq('id', …).single()
          const isSessionLookup = calls.some(([m, a]) => m === 'eq' && a[0] === 'id');
          if (isSessionLookup) {
            return {
              data: { id: 'session-user', email: `${role}@test.com`, full_name: role, role, status: 'activo' },
              error: null,
            };
          }
          return employees;
        });
      } else if (table === 'rotation_assignments') {
        q = makeQuery((calls) => {
          if (opts.assignmentsError) return { data: null, error: opts.assignmentsError };
          const range = calls.find(([m]) => m === 'range');
          const [from, to] = (range?.[1] ?? [0, 999]) as [number, number];
          const end = Math.min(to + 1, from + maxRows);
          return { data: assignments.slice(from, end), error: null };
        });
      } else {
        throw new Error(`tabla inesperada: ${table}`);
      }
      queries[table].push(q);
      return q;
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return { client, queries };
}

async function readWorkbook(base64: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as XlsxInput);
  return wb.getWorksheet(copy.calendario.excel.hojas.calendario)!;
}

const RANGO = { desde: '2026-06-01', hasta: '2026-06-03' };

beforeEach(() => {
  vi.clearAllMocks();
  buildFailure.enabled = false;
  vi.mocked(redirect).mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('exportarCalendarioExcel: límite de rol (3 roles, guard real)', () => {
  it('admin: exporta el archivo', async () => {
    mockClient({ role: 'admin' });
    const result = await exportarCalendarioExcel(RANGO);

    expect(redirect).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe('calendario_2026-06-01_a_2026-06-03.xlsx');
    const sheet = await readWorkbook(result.base64);
    expect(sheet.rowCount - 1).toBe(EMPLEADOS.length * 3);
  });

  it.each(['supervisor', 'empleado'] as const)(
    '%s: corte server-side por redirect, sin leer calendario',
    async (role) => {
      const { client, queries } = mockClient({ role });

      await expect(exportarCalendarioExcel(RANGO)).rejects.toThrow('NEXT_REDIRECT');

      expect(redirect).toHaveBeenCalledWith('/dashboard');
      // Solo la lectura del propio perfil de requireAuth(); nada más.
      expect(client.from).toHaveBeenCalledTimes(1);
      expect(client.from).toHaveBeenCalledWith('profiles');
      expect(queries.rotation_assignments).toHaveLength(0);
    }
  );
});

describe('exportarCalendarioExcel: rango', () => {
  it.each([
    [{ desde: '', hasta: '2026-06-03' }, copy.calendario.excel.errors.fechaInvalida],
    [{ desde: '2026-02-30', hasta: '2026-03-03' }, copy.calendario.excel.errors.fechaInvalida],
    [{ desde: '01/06/2026', hasta: '2026-06-03' }, copy.calendario.excel.errors.fechaInvalida],
    [{ desde: '2026-06-10', hasta: '2026-06-01' }, copy.calendario.excel.errors.rangoInvertido],
    [{ desde: '2026-01-01', hasta: '2027-01-02' }, copy.calendario.excel.errors.rangoExcedido],
  ])('%o → { ok: false } con copy es-AR, sin leer datos', async (input, mensaje) => {
    const { queries } = mockClient({ role: 'admin' });
    const result = await exportarCalendarioExcel(input);
    expect(result).toEqual({ ok: false, error: mensaje });
    expect(queries.profiles).toHaveLength(1); // solo requireAuth()
    expect(queries.rotation_assignments).toHaveLength(0);
  });

  it('366 días (año bisiesto completo) es válido', async () => {
    mockClient({ role: 'admin', employees: { data: [], error: null } });
    const result = await exportarCalendarioExcel({ desde: '2028-01-01', hasta: '2028-12-31' });
    expect(result.ok).toBe(true);
  });
});

describe('exportarCalendarioExcel: lectura', () => {
  it('pide solo empleados y supervisores activos, ordenados por nombre', async () => {
    const { queries } = mockClient({ role: 'admin' });
    await exportarCalendarioExcel(RANGO);

    const empleadosQuery = queries.profiles[1];
    expect(empleadosQuery.calls).toContainEqual(['eq', ['status', 'activo']]);
    expect(empleadosQuery.calls).toContainEqual(['in', ['role', ['empleado', 'supervisor']]]);
    expect(empleadosQuery.calls).toContainEqual(['order', ['full_name', { ascending: true }]]);
  });

  it('pagina rotation_assignments: no se trunca en el tope de filas del servidor', async () => {
    // 3 empleados × 366 días = 1098 filas, más que cualquier página.
    const empleados = [
      { id: 'u-1', full_name: 'Uno', email: 'uno@firstblades.test' },
      { id: 'u-2', full_name: 'Dos', email: 'dos@firstblades.test' },
      { id: 'u-3', full_name: 'Tres', email: 'tres@firstblades.test' },
    ];
    const desde = '2028-01-01';
    const hasta = '2028-12-31';
    const dias: string[] = [];
    for (let ms = Date.UTC(2028, 0, 1); ms <= Date.UTC(2028, 11, 31); ms += 86_400_000) {
      dias.push(new Date(ms).toISOString().slice(0, 10));
    }
    const assignments = empleados.flatMap((e) =>
      dias.map((fecha) => ({
        user_id: e.id, fecha, estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null,
      }))
    );

    // maxRows 400 < PAGE_SIZE: el servidor corta antes que nuestra página.
    const { queries } = mockClient({
      role: 'admin',
      employees: { data: empleados, error: null },
      assignments,
      maxRows: 400,
    });
    const result = await exportarCalendarioExcel({ desde, hasta });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1098 filas en páginas de 400 → 3 páginas con datos + 1 vacía de cierre.
    expect(queries.rotation_assignments).toHaveLength(4);
    const sheet = await readWorkbook(result.base64);
    let vacias = 0;
    for (let r = 2; r <= sheet.rowCount; r++) {
      if (!sheet.getRow(r).getCell(4).value) vacias++;
    }
    expect(sheet.rowCount - 1).toBe(1098);
    expect(vacias).toBe(0);
  });

  it('error de PostgREST al leer empleados → { ok: false }, sin tirar', async () => {
    mockClient({ role: 'admin', employees: { data: null, error: { message: 'boom' } } });
    const result = await exportarCalendarioExcel(RANGO);
    expect(result).toEqual({ ok: false, error: copy.calendario.excel.errors.generacion });
  });

  it('error de PostgREST al leer asignaciones → { ok: false }, sin tirar', async () => {
    mockClient({ role: 'admin', assignmentsError: { message: 'boom' } });
    const result = await exportarCalendarioExcel(RANGO);
    expect(result).toEqual({ ok: false, error: copy.calendario.excel.errors.generacion });
  });

  it('falla la generación del archivo → { ok: false }, sin tirar', async () => {
    mockClient({ role: 'admin' });
    buildFailure.enabled = true;
    const result = await exportarCalendarioExcel(RANGO);
    expect(result).toEqual({ ok: false, error: copy.calendario.excel.errors.generacion });
  });
});
