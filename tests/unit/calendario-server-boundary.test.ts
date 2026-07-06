/**
 * Tests de límite de rol en servidor — server action de la grilla del
 * roster (FB-F3-04, upsertRotationAssignment).
 *
 * Mockea @/lib/auth (requireAdmin) y @/lib/supabase/server para ejercitar
 * el código real de la action sin tocar la base. Simula que requireAdmin()
 * rechaza para no-admin (igual que redirect() corta la ejecución en el
 * runtime real de Next.js) y verifica que el write a rotation_assignments
 * NUNCA se invoca en ese caso. La RLS de rotation_assignments (admin
 * completo, sin escritura no-admin) ya está cubierta a nivel de base en
 * tests/integration/rls.test.ts; esto testea que el código de la app no
 * intenta escribir antes de que la RLS lo bloquee.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { requireAdmin, requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { upsertRotationAssignment } from '@/app/(app)/calendario/actions';
import CalendarioPage from '@/app/(app)/calendario/page';
import { RosterGrid } from '@/app/(app)/calendario/RosterGrid';
import { FrancoAlertPanel } from '@/app/(app)/calendario/FrancoAlertPanel';
import { copy } from '@/lib/copy';

const VALID_INPUT = {
  user_id: 'emp-1',
  fecha: '2026-07-10',
  estado_dia: 'trabajando' as const,
  es_estimado: false,
};

function mockAdminSession() {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: 'admin-1',
    role: 'admin',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function mockSupabaseUpsert(error: { message: string } | null = null) {
  const upsertMock = vi.fn().mockResolvedValue({ error });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { upsertMock, fromMock };
}

describe('upsertRotationAssignment: gating de servidor (no-admin rechazado)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-admin: requireAdmin rechaza y el upsert NUNCA se invoca', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('NEXT_REDIRECT'));
    const { upsertMock } = mockSupabaseUpsert();

    await expect(upsertRotationAssignment(VALID_INPUT)).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('admin: input válido invoca upsert con onConflict user_id,fecha y el payload correcto', async () => {
    mockAdminSession();
    const { upsertMock, fromMock } = mockSupabaseUpsert();

    await upsertRotationAssignment(VALID_INPUT);

    expect(fromMock).toHaveBeenCalledWith('rotation_assignments');
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 'emp-1',
          fecha: '2026-07-10',
          estado_dia: 'trabajando',
          es_estimado: false,
          motivo_ausencia: null,
          motivo_otros_texto: null,
        }),
      ],
      { onConflict: 'user_id,fecha' }
    );
  });

  it('admin: periodo_fuera_trabajo sin motivo bloquea ANTES de llamar upsert (defensa en profundidad)', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert();

    await expect(
      upsertRotationAssignment({
        user_id: 'emp-1',
        fecha: '2026-07-10',
        estado_dia: 'periodo_fuera_trabajo',
        es_estimado: false,
      })
    ).rejects.toThrow(copy.calendario.errors.motivoRequerido);

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('admin: periodo_fuera_trabajo con motivo "otros" sin texto bloquea antes de llamar upsert', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert();

    await expect(
      upsertRotationAssignment({
        user_id: 'emp-1',
        fecha: '2026-07-10',
        estado_dia: 'periodo_fuera_trabajo',
        es_estimado: false,
        motivo_ausencia: 'otros',
      })
    ).rejects.toThrow(copy.calendario.errors.motivoOtrosRequerido);

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('admin: error de Supabase en el upsert se traduce al copy es-AR genérico', async () => {
    mockAdminSession();
    mockSupabaseUpsert({ message: 'db error interno' });

    await expect(upsertRotationAssignment(VALID_INPUT)).rejects.toThrow(
      copy.calendario.messages.upsertError
    );
  });
});

// ─── CalendarioPage: branch por rol (FB-F3-06) ────────────────────────────
//
// admin gestiona (RosterGrid editable); supervisor/empleado ven en modo
// lectura (RosterGrid readOnly). Estos tests invocan la Server Component
// directamente (es una función async que devuelve JSX, sin renderizar DOM)
// y verifican el elemento RosterGrid dentro del árbol devuelto + los
// filtros que arma cada rol en la query de profiles (scope de app
// superpuesto a la RLS, ver app/(app)/calendario/page.tsx).

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

// Sin renderer real: CalendarioPage devuelve <RosterView .../> (un
// componente función), no el árbol de RosterView ya "renderizado". Para
// encontrar un elemento sin montar un renderer completo, cuando el nodo es
// un componente función que no es el target, se lo invoca directamente
// (son todos puros / sin hooks — Card, MonthNav, Legend, RosterView,
// MotivoDashboard, FrancoAlertPanel) para bajar un nivel más. RosterGrid es
// la única excepción: usa useState, así que NUNCA se invoca (ni como
// target — el chequeo de igualdad corta antes — ni de paso buscando otro
// elemento): si se llega a él sin haber encontrado el target, se corta la
// rama ahí (no puede contener el target de todas formas, es una hoja).
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
  if (el.type === RosterGrid) return undefined;
  if (typeof el.type === 'function') {
    const rendered = (el.type as (props: unknown) => unknown)(el.props);
    return findElement(rendered, type);
  }
  return findElement((el.props as { children?: unknown } | undefined)?.children, type);
}

function mockProfileRole(role: 'admin' | 'supervisor' | 'empleado', id = 'user-1') {
  vi.mocked(requireAuth).mockResolvedValue({
    id,
    role,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

// Mock genérico de la cadena .from('profiles').select(...).eq(...)[.in()|.or()](...).order(...)
// con 0 empleados: alcanza para probar el branch de render sin necesitar
// también mockear la query de rotation_assignments (se skipea si employeeIds
// está vacío). Cada método intermedio devuelve el mismo builder para
// soportar cualquier combinación de filtros según el rol (in para admin,
// or para supervisor, eq para empleado).
function mockEmptyProfilesQuery() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'or']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.order = vi.fn().mockResolvedValue({ data: [], error: null });
  const from = vi.fn().mockReturnValue(builder);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from } as any);
  return { from, builder };
}

describe('CalendarioPage: branch por rol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supervisor recibe la vista de lectura (RosterGrid readOnly), no la de gestión', async () => {
    mockProfileRole('supervisor');
    mockEmptyProfilesQuery();

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });

    const grid = findElement(result, RosterGrid);
    expect(grid).toBeTruthy();
    expect(grid?.props?.readOnly).toBe(true);
  });

  it('empleado recibe la vista de lectura (RosterGrid readOnly), no la de gestión', async () => {
    mockProfileRole('empleado');
    mockEmptyProfilesQuery();

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });

    const grid = findElement(result, RosterGrid);
    expect(grid).toBeTruthy();
    expect(grid?.props?.readOnly).toBe(true);
  });

  it('admin recibe la vista de gestión (RosterGrid editable, readOnly=false) — regresión', async () => {
    mockProfileRole('admin');
    mockEmptyProfilesQuery();

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });

    const grid = findElement(result, RosterGrid);
    expect(grid).toBeTruthy();
    expect(grid?.props?.readOnly).toBe(false);
  });

  it('supervisor: la query de profiles filtra por equipo + sí mismo (or), no por lista de roles', async () => {
    mockProfileRole('supervisor', 'sup-1');
    const { builder } = mockEmptyProfilesQuery();

    await CalendarioPage({ searchParams: Promise.resolve({}) });

    expect(builder.or).toHaveBeenCalledWith('id.eq.sup-1,supervisor_id.eq.sup-1');
    expect(builder.in).not.toHaveBeenCalled();
  });

  it('empleado: la query de profiles filtra solo por su id', async () => {
    mockProfileRole('empleado', 'emp-9');
    const { builder } = mockEmptyProfilesQuery();

    await CalendarioPage({ searchParams: Promise.resolve({}) });

    expect(builder.eq).toHaveBeenCalledWith('id', 'emp-9');
    expect(builder.or).not.toHaveBeenCalled();
    expect(builder.in).not.toHaveBeenCalled();
  });

  it('admin: la query de profiles filtra por roles empleado/supervisor — regresión', async () => {
    mockProfileRole('admin');
    const { builder } = mockEmptyProfilesQuery();

    await CalendarioPage({ searchParams: Promise.resolve({}) });

    expect(builder.in).toHaveBeenCalledWith('role', ['empleado', 'supervisor']);
    expect(builder.or).not.toHaveBeenCalled();
  });
});

// ─── FrancoAlertPanel: visible solo para admin/supervisor (FB-F3-09) ──────
//
// "Empleado no ve el panel" es una decisión de producto (herramienta de
// gestión), no un límite de RLS — se prueba acá, a nivel de page.tsx, no
// en integración DB-backed (esa cubre el scope de admin/supervisor, ver
// tests/integration/calendario-franco-scope.test.ts).

// Mock de .from('profiles') Y .from('rotation_assignments') con datos: a
// diferencia de mockEmptyProfilesQuery, acá employeeIds no está vacío, así
// que también corren la query de asignaciones de la grilla y (si
// corresponde) la de alertas de franco. Rutea por nombre de tabla.
function mockProfilesAndAssignments(employees: unknown[], assignments: unknown[] = []) {
  function makeBuilder(finalData: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const method of ['select', 'eq', 'in', 'or', 'gte']) {
      builder[method] = vi.fn().mockReturnValue(builder);
    }
    // .order() termina la cadena de profiles; .lte() termina la de
    // rotation_assignments (ninguna de las dos queries de asignaciones usa order()).
    builder.order = vi.fn().mockResolvedValue({ data: finalData, error: null });
    builder.lte = vi.fn().mockResolvedValue({ data: finalData, error: null });
    return builder;
  }

  const profilesBuilder = makeBuilder(employees);
  const assignmentsBuilder = makeBuilder(assignments);
  const from = vi.fn((table: string) => (table === 'profiles' ? profilesBuilder : assignmentsBuilder));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from } as any);
  return { from, profilesBuilder, assignmentsBuilder };
}

describe('CalendarioPage: visibilidad del panel de alertas de franco por rol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empleado: NO ve el panel de alertas de franco', async () => {
    mockProfileRole('empleado', 'emp-9');
    mockProfilesAndAssignments([{ id: 'emp-9', full_name: 'Empleado Nueve', email: 'emp9@test.com' }]);

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });

    expect(findElement(result, FrancoAlertPanel)).toBeUndefined();
  });

  it('admin: SÍ ve el panel de alertas de franco', async () => {
    mockProfileRole('admin');
    mockProfilesAndAssignments([{ id: 'e1', full_name: 'Empleado Uno', email: 'e1@test.com' }]);

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });

    const panel = findElement(result, FrancoAlertPanel);
    expect(panel).toBeTruthy();
    expect(panel?.props?.rows).toEqual([]);
  });

  it('supervisor: SÍ ve el panel de alertas de franco', async () => {
    mockProfileRole('supervisor', 'sup-1');
    mockProfilesAndAssignments([{ id: 'sup-1', full_name: 'Sup Uno', email: 'sup1@test.com' }]);

    const result = await CalendarioPage({ searchParams: Promise.resolve({}) });

    expect(findElement(result, FrancoAlertPanel)).toBeTruthy();
  });
});
