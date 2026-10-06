/**
 * FB-PI-05 — Lecturas completas por encima del tope de PostgREST.
 *
 * El cliente simulado reproduce EXACTAMENTE la falla real: cada respuesta se
 * corta en MAX_ROWS (1000) filas SIN devolver error. Con más de 1000 filas en
 * juego, cada página se verifica entera — si alguien saca la paginación de
 * cualquiera de estas lecturas (vuelve a un select sin .range()), la página
 * recibe 1000 filas y el test se pone rojo.
 *
 * Cubre las lecturas de página del diagnóstico (docs/audits/FB-PI-05-DIAG.md
 * §6): roster del Calendario (C), alertas de franco en Calendario (A),
 * Aprobadas (F, G) y Equipo (H). Las de los crons (B, D, E, I) se cubren
 * contra PostgREST real en tests/integration/lecturas-completas.test.ts.
 *
 * Los filtros no se simulan: cada tabla devuelve el conjunto que se le da
 * (ya es "el resultado de la query"). Lo que se simula es el corte.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(), requireAuth: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { cookies } from 'next/headers';
import { requireAdmin, requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import CalendarioPage from '@/app/(app)/calendario/page';
import { CalendarioSections } from '@/app/(app)/calendario/CalendarioSections';
import { getFrancoAlertWindowStart } from '@/app/(app)/calendario/francoAlerts';
import { getBusinessToday } from '@/lib/rotation/promote-estimated';
import AprobadasPage from '@/app/(app)/aprobadas/page';
import { AprobadasTable } from '@/app/(app)/aprobadas/AprobadasTable';
import EquipoPage from '@/app/(app)/equipo/page';
import { EquipoTable } from '@/app/(app)/equipo/EquipoTable';

const MAX_ROWS = 1000;

// Cliente que se comporta como PostgREST con max_rows = 1000: sin .range()
// devuelve las primeras 1000; con .range(from, to) devuelve esa porción, y
// nunca más de 1000. Jamás devuelve error por el corte.
function simulatedPostgrest(tables: Record<string, unknown[]>) {
  const requests: { table: string; range: [number, number] | null; returned: number }[] = [];

  function builder(table: string) {
    const rows = tables[table] ?? [];
    let range: [number, number] | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'or', 'not', 'is', 'gte', 'lte', 'order']) {
      b[m] = () => b;
    }
    b.range = (from: number, to: number) => {
      range = [from, to];
      return b;
    };
    b.then = (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) => {
      const from = range ? range[0] : 0;
      const end = range ? Math.min(range[1] + 1, from + MAX_ROWS) : MAX_ROWS;
      const data = rows.slice(from, end);
      requests.push({ table, range, returned: data.length });
      return Promise.resolve({ data, error: null }).then(onOk, onErr);
    };
    return b;
  }

  const client = { from: (table: string) => builder(table) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return { requests };
}

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

// Busca un elemento por tipo en el árbol devuelto por un Server Component,
// invocando los componentes funcionales que haya en el camino (ej.
// RosterView). El buscado no se invoca. Un componente con hooks fuera de un
// render de React tira: esa rama se descarta (no es donde está el buscado).
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
    let rendered: unknown;
    try {
      rendered = (el.type as (props: unknown) => unknown)(el.props);
    } catch {
      return undefined;
    }
    return findElement(rendered, type);
  }
  return findElement((el.props as { children?: unknown } | undefined)?.children, type);
}

function isoDays(desde: string, hasta: string): string[] {
  const [ay, am, ad] = desde.split('-').map(Number);
  const [by, bm, bd] = hasta.split('-').map(Number);
  const out: string[] = [];
  for (let ms = Date.UTC(ay, am - 1, ad); ms <= Date.UTC(by, bm - 1, bd); ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

function empleados(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const k = String(i + 1).padStart(2, '0');
    return { id: `emp-${k}`, full_name: `Empleado ${k}`, email: `emp${k}@test.com` };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'admin' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAuth).mockResolvedValue({ id: 'admin-1', role: 'admin' } as any);
  const get = vi.fn(() => undefined);
  vi.mocked(cookies).mockResolvedValue({ get } as never);
});

describe('Calendario: roster por encima del umbral (C)', () => {
  it('40 empleados × enero (31 días) = 1240 asignaciones: la grilla las recibe TODAS', async () => {
    const emps = empleados(40); // umbral del diagnóstico: 33
    const dias = isoDays('2026-01-01', '2026-01-31');
    const asignaciones = emps.flatMap((e) =>
      dias.map((fecha) => ({ user_id: e.id, fecha, estado_dia: 'trabajando', es_estimado: false }))
    );
    expect(asignaciones.length).toBeGreaterThan(MAX_ROWS);

    simulatedPostgrest({ profiles: emps, rotation_assignments: asignaciones });

    const result = await CalendarioPage({ searchParams: Promise.resolve({ year: '2026', month: '1' }) });
    const sections = findElement(result, CalendarioSections);
    const recibidas = sections?.props?.assignments as { user_id: string; fecha: string }[];

    expect(recibidas).toHaveLength(1240);
    // El último empleado (el que el corte dejaba afuera) tiene su mes completo.
    expect(recibidas.filter((a) => a.user_id === 'emp-40')).toHaveLength(31);
  });
});

describe('Calendario: alertas de franco por encima del umbral (A)', () => {
  it('20 empleados × 66 días trabajados = 1320 días: los 20 entran en alerta "sin franco"', async () => {
    const emps = empleados(20); // umbral del diagnóstico: 16
    const today = getBusinessToday();
    const dias = isoDays(getFrancoAlertWindowStart(today), today);
    expect(dias).toHaveLength(66);
    const asignaciones = emps.flatMap((e) =>
      dias.map((fecha) => ({ user_id: e.id, fecha, estado_dia: 'trabajando', es_estimado: false }))
    );
    expect(asignaciones.length).toBeGreaterThan(MAX_ROWS);

    simulatedPostgrest({ profiles: emps, rotation_assignments: asignaciones });

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });
    const sections = findElement(result, CalendarioSections);
    const alertas = sections?.props?.francoAlertRows as { employeeId: string; tipo: string }[];

    const conAlerta = new Set(alertas.filter((a) => a.tipo === 'sin_franco').map((a) => a.employeeId));
    // Truncado en 1000, los empleados 17–20 quedaban sin días → sin alerta.
    expect(conAlerta.size).toBe(20);
  });
});

describe('Aprobadas: historial por encima del umbral (F, G)', () => {
  it('1100 ausencias + 1050 pasajes aprobados: el listado los recibe TODOS', async () => {
    const ausencias = Array.from({ length: 1100 }, (_, i) => ({
      id: `aus-${i}`,
      user_id: 'emp-01',
      reviewed_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
      user_profile: { full_name: 'Empleado 01', email: 'emp01@test.com' },
    }));
    const pasajes = Array.from({ length: 1050 }, (_, i) => ({
      id: `pas-${i}`,
      empleado_id: 'emp-02',
      reviewed_at: '2026-02-01T00:00:00Z',
      empleado_profile: { full_name: 'Empleado 02', email: 'emp02@test.com' },
    }));

    simulatedPostgrest({ ausencia_requests: ausencias, pasaje_requests: pasajes });

    const result = await AprobadasPage();
    const table = findElement(result, AprobadasTable);
    const items = table?.props?.items as { kind: string }[];

    expect(items.filter((i) => i.kind === 'ausencia')).toHaveLength(1100);
    expect(items.filter((i) => i.kind === 'pasaje')).toHaveLength(1050);
  });
});

describe('Equipo: documentos con vencimiento por encima del umbral (H)', () => {
  it('1100 documentos vencidos en 11 perfiles: los conteos suman 1100', async () => {
    const perfiles = Array.from({ length: 11 }, (_, i) => ({
      id: `p-${i}`,
      full_name: `Perfil ${i}`,
      email: `p${i}@test.com`,
      supervisor_id: null,
      role: 'empleado',
      status: 'activo',
    }));
    const docs = perfiles.flatMap((p) =>
      Array.from({ length: 100 }, (_, j) => ({
        id: `${p.id}-doc-${j}`,
        user_id: p.id,
        document_type: 'certificado',
        certificado_tipo: 'gwo',
        certificado_otros_texto: null,
        fecha_vencimiento: '2020-01-01', // vencido
      }))
    );

    simulatedPostgrest({ profiles: perfiles, documents: docs });

    const result = await EquipoPage();
    const table = findElement(result, EquipoTable);
    const rows = table?.props?.profiles as { doc_vencidos: number }[];

    expect(rows.reduce((acc, r) => acc + r.doc_vencidos, 0)).toBe(1100);
  });
});
