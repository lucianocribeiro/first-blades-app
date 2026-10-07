/**
 * FB-PI-11 — Server Actions del import del calendario
 * (app/(app)/calendario/import-actions.ts).
 *
 * Límite de rol para los 3 roles con el guard REAL (lib/auth.ts →
 * requireAdmin → requireRole → requireAuth): solo se mockea el cliente de
 * Supabase y redirect(), que acá tira como en producción. Supervisor y
 * empleado cortan por redirect ANTES de leer el archivo o la base.
 *
 * También: la previsualización nunca escribe; la confirmación no existe sin
 * la previsualización (hash + conteos), con errores queda bloqueada, y los
 * errores de la RPC se leen como valor (§2.5) y se traducen a copy es-AR.
 * Nunca se usa createAdminClient (la guarda auth.uid() de la RPC abortaría).
 *
 * El File es el de node:buffer (el File de jsdom no implementa
 * arrayBuffer()); el FormData es un mapa mínimo con .get(), que es todo lo
 * que usa la action.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { File } from 'node:buffer';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient no debe usarse en el import');
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  previsualizarImportCalendario,
  confirmarImportCalendario,
} from '@/app/(app)/calendario/import-actions';
import { buildCalendarioWorkbook } from '@/lib/rotation/calendario-excel';
import type { CalendarioExportData } from '@/lib/rotation/calendario-export';
import { copy } from '@/lib/copy';

const E = copy.calendario.excel.importar.errores;

type Role = 'admin' | 'supervisor' | 'empleado';
type Result = { data: unknown; error: { message: string; code?: string } | null };

const PROFILES = [
  { id: 'u-ana', email: 'ana@fb.test', full_name: 'Ana Pérez', role: 'empleado', status: 'activo' },
  { id: 'u-beto', email: 'beto@fb.test', full_name: 'Beto Gómez', role: 'supervisor', status: 'activo' },
];

const EXPORT_DATA: CalendarioExportData = {
  employees: [
    { id: 'u-ana', full_name: 'Ana Pérez', email: 'ana@fb.test' },
    { id: 'u-beto', full_name: 'Beto Gómez', email: 'beto@fb.test' },
  ],
  assignments: [
    { user_id: 'u-ana', fecha: '2026-07-01', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
  ],
};

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
  return q;
}

// Sirve una tabla completa paginada por .range(), como PostgREST.
function paged(rows: unknown[]) {
  return (calls: [string, unknown[]][]): Result => {
    const range = calls.find(([m]) => m === 'range');
    const [from, to] = (range?.[1] ?? [0, 999]) as [number, number];
    return { data: rows.slice(from, to + 1), error: null };
  };
}

type ClientOptions = {
  role: Role;
  actuales?: unknown[];
  ausencias?: unknown[];
  rpcResult?: Result;
  profilesError?: boolean;
};

function mockClient(opts: ClientOptions) {
  const { role, actuales = [], ausencias = [], rpcResult = { data: { creadas: 1, modificadas: 0, borradas: 0, sin_cambios: 3, pisadas: 0 }, error: null } } = opts;
  const tablas: string[] = [];
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'session-user' } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc,
    from: vi.fn((table: string) => {
      tablas.push(table);
      if (table === 'profiles') {
        return makeQuery((calls) => {
          if (calls.some(([m, a]) => m === 'eq' && a[0] === 'id')) {
            return { data: { id: 'session-user', email: `${role}@test.com`, full_name: role, role, status: 'activo' }, error: null };
          }
          if (opts.profilesError) return { data: null, error: { message: 'caída' } };
          return paged(PROFILES)(calls);
        });
      }
      if (table === 'rotation_assignments') {
        return makeQuery((calls) => {
          const tramite = calls.some(([m, a]) => m === 'eq' && a[0] === 'motivo_ausencia');
          return paged(tramite ? [] : actuales)(calls);
        });
      }
      if (table === 'ausencia_requests') return makeQuery(paged(ausencias));
      if (table === 'pasaje_requests') return makeQuery(paged([]));
      throw new Error(`tabla inesperada: ${table}`);
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return { client, rpc, tablas };
}

// Archivo del export, reimportado: Ana tiene 07-01 trabajando; el resto
// (Ana 07-02/03, Beto 07-01/02/03) vacío. Con el calendario actual vacío:
// 1 crear, 5 sin cambios.
async function archivoExportado(data = EXPORT_DATA): Promise<File> {
  const buffer = await buildCalendarioWorkbook(data, '2026-07-01', '2026-07-03');
  return new File([new Uint8Array(buffer)], 'calendario.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function hashDe(file: File) {
  return createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
}

function form(entries: Record<string, string | File>): FormData {
  const map = new Map<string, unknown>(Object.entries(entries));
  return { get: (key: string) => map.get(key) ?? null } as unknown as FormData;
}

const ESPERADO = { crear: 1, modificar: 0, borrar: 0, sin_cambios: 5, pisados: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(redirect).mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('import del calendario: límite de rol (3 roles, guard real)', () => {
  it('admin: previsualiza y confirma', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const file = await archivoExportado();

    const preview = await previsualizarImportCalendario(form({ file }));
    expect(redirect).not.toHaveBeenCalled();
    expect(preview.ok).toBe(true);

    const confirm = await confirmarImportCalendario(
      form({ file, hash: await hashDe(file), esperado: JSON.stringify(ESPERADO) })
    );
    expect(confirm.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['supervisor', 'empleado'] as const)(
    '%s: corte server-side por redirect en ambas actions, sin leer calendario ni llamar a la RPC',
    async (role) => {
      const { client, rpc, tablas } = mockClient({ role });
      const file = await archivoExportado();

      await expect(previsualizarImportCalendario(form({ file }))).rejects.toThrow('NEXT_REDIRECT');
      await expect(
        confirmarImportCalendario(form({ file, hash: 'x', esperado: JSON.stringify(ESPERADO) }))
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(redirect).toHaveBeenCalledWith('/dashboard');
      // Solo la lectura del propio perfil de requireAuth(), una por action.
      expect(client.from).toHaveBeenCalledTimes(2);
      expect(tablas).toEqual(['profiles', 'profiles']);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});

describe('previsualizarImportCalendario', () => {
  it('no escribe: calcula los conteos y nunca llama a la RPC', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const file = await archivoExportado();

    const result = await previsualizarImportCalendario(form({ file }));

    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.conteos).toEqual(ESPERADO);
    expect(result.preview.archivo.hash).toBe(await hashDe(file));
    expect(result.preview).toMatchObject({ desde: '2026-07-01', hasta: '2026-07-03', totalFilas: 6, erroresTotal: 0 });
  });

  it('borrados y pisados se listan uno por uno', async () => {
    mockClient({
      role: 'admin',
      actuales: [
        { id: 'ra-1', user_id: 'u-ana', fecha: '2026-07-01', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null, es_estimado: false },
        { id: 'ra-2', user_id: 'u-beto', fecha: '2026-07-02', estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'vacaciones', motivo_otros_texto: null, notas: null, es_estimado: false },
      ],
      ausencias: [{ id: 'aus-1', user_id: 'u-beto', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-05', post_aprobacion_tipo: null }],
    });
    // El archivo deja vacío el 07-02 de Beto: borra un día de una ausencia aprobada.
    const result = await previsualizarImportCalendario(form({ file: await archivoExportado() }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.conteos).toEqual({ crear: 0, modificar: 0, borrar: 1, sin_cambios: 5, pisados: 1 });
    const esperadoDia = {
      fila: expect.any(Number),
      nombre: 'Beto Gómez',
      fecha: '2026-07-02',
      actual: 'periodo_fuera_trabajo',
      nuevo: null,
      solicitudes: [{ tipo: 'ausencia', id: 'aus-1' }],
    };
    expect(result.preview.borrados).toEqual([esperadoDia]);
    expect(result.preview.pisados).toEqual([esperadoDia]);
  });

  it('con errores de validación: devuelve los errores con fila y sin conteos (no hay qué confirmar)', async () => {
    mockClient({ role: 'admin' });
    const file = await archivoExportado({
      ...EXPORT_DATA,
      employees: [...EXPORT_DATA.employees, { id: 'u-x', full_name: 'Nadie', email: 'nadie@fb.test' }],
    });

    const result = await previsualizarImportCalendario(form({ file }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.conteos).toBeNull();
    expect(result.preview.erroresTotal).toBe(3);
    expect(result.preview.errores[0]).toEqual({ fila: expect.any(Number), mensaje: E.emailInexistente });
  });

  it.each([
    ['sin archivo', {}, E.archivoRequerido],
    ['no .xlsx', { file: new File(['x'], 'calendario.csv') }, E.archivoTipo],
    ['más de 1 MB', { file: new File([new Uint8Array(1_000_001)], 'calendario.xlsx') }, E.archivoGrande],
    ['ilegible', { file: new File(['no soy xlsx'], 'calendario.xlsx') }, E.archivoIlegible],
  ])('archivo inválido (%s): { ok: false } con copy es-AR', async (_c, entries, error) => {
    mockClient({ role: 'admin' });
    expect(await previsualizarImportCalendario(form(entries as Record<string, File>))).toEqual({ ok: false, error });
  });

  it('falla la lectura de perfiles (error de PostgREST como valor): { ok: false }, sin tirar', async () => {
    mockClient({ role: 'admin', profilesError: true });
    const result = await previsualizarImportCalendario(form({ file: await archivoExportado() }));
    expect(result).toEqual({ ok: false, error: E.lectura });
  });
});

describe('confirmarImportCalendario: la previsualización no se puede saltear', () => {
  it('sin hash o sin conteos de la previsualización: no se llama a la RPC', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const file = await archivoExportado();

    expect(await confirmarImportCalendario(form({ file }))).toEqual({ ok: false, error: E.sinPrevisualizar });
    expect(await confirmarImportCalendario(form({ file, hash: await hashDe(file) }))).toEqual({ ok: false, error: E.sinPrevisualizar });
    expect(
      await confirmarImportCalendario(form({ file, hash: await hashDe(file), esperado: '{"crear":1}' }))
    ).toEqual({ ok: false, error: E.sinPrevisualizar });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('otro archivo que el previsualizado (hash distinto): desactualizado, sin RPC', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const result = await confirmarImportCalendario(
      form({ file: await archivoExportado(), hash: 'otro', esperado: JSON.stringify(ESPERADO) })
    );
    expect(result).toEqual({ ok: false, error: E.archivoDistinto, desactualizado: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('con errores de validación: confirmación bloqueada, sin RPC', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const file = await archivoExportado({
      ...EXPORT_DATA,
      employees: [...EXPORT_DATA.employees, { id: 'u-x', full_name: 'Nadie', email: 'nadie@fb.test' }],
    });
    const result = await confirmarImportCalendario(
      form({ file, hash: await hashDe(file), esperado: JSON.stringify(ESPERADO) })
    );
    expect(result).toEqual({ ok: false, error: E.conErrores });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('los conteos recalculados ya no coinciden con los vistos: desactualizado, sin RPC', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const file = await archivoExportado();
    const result = await confirmarImportCalendario(
      form({ file, hash: await hashDe(file), esperado: JSON.stringify({ ...ESPERADO, crear: 0, sin_cambios: 6 }) })
    );
    expect(result).toEqual({ ok: false, error: E.desactualizado, desactualizado: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('llama a la RPC con el lote normalizado y los conteos VISTOS, por el cliente de sesión', async () => {
    const { rpc } = mockClient({ role: 'admin' });
    const file = await archivoExportado();

    const result = await confirmarImportCalendario(
      form({ file, hash: await hashDe(file), esperado: JSON.stringify(ESPERADO) })
    );

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('importar_calendario', {
      p_filas: expect.arrayContaining([
        { email: 'ana@fb.test', fecha: '2026-07-01', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
        { email: 'beto@fb.test', fecha: '2026-07-03', estado_dia: null, motivo_ausencia: null, motivo_otros_texto: null, notas: null },
      ]),
      p_esperado: ESPERADO,
    });
    expect((rpc.mock.calls[0] as unknown as [string, { p_filas: unknown[] }])[1].p_filas).toHaveLength(6);
    expect(result).toEqual({ ok: true, resultado: { creadas: 1, modificadas: 0, borradas: 0, sin_cambios: 3, pisadas: 0 } });
    expect(revalidatePath).toHaveBeenCalledWith('/calendario');
  });

  it.each([
    ['40001 (el calendario cambió dentro de la transacción)', { message: 'cambió', code: '40001' }, { ok: false, error: E.desactualizado, desactualizado: true }],
    ['42501 (guarda de admin)', { message: 'no', code: '42501' }, { ok: false, error: E.escritura }],
    ['22023 (validación de la RPC)', { message: 'fila', code: '22023' }, { ok: false, error: E.escritura }],
  ])('error de la RPC %s: se lee como valor y se traduce, sin revalidar', async (_c, rpcError, expected) => {
    mockClient({ role: 'admin', rpcResult: { data: null, error: rpcError } });
    const file = await archivoExportado();

    const result = await confirmarImportCalendario(
      form({ file, hash: await hashDe(file), esperado: JSON.stringify(ESPERADO) })
    );

    expect(result).toEqual(expected);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
