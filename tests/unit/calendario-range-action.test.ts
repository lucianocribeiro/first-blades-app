/**
 * Tests de límite de rol y comportamiento — server action de pintado por
 * rango del roster (FB-F3-23, upsertRotationRange).
 *
 * Mockea @/lib/auth (requireAdmin), @/lib/supabase/server y
 * @/lib/rotation/promote-estimated (getBusinessToday fijo, para que
 * es_estimado por día sea determinístico) para ejercitar el código real de
 * la action sin tocar la base. El upsert es best-effort: un día que falla
 * NO aborta el resto — se verifica acá con un mock que responde distinto
 * según la fecha del payload.
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

vi.mock('@/lib/rotation/promote-estimated', () => ({
  getBusinessToday: vi.fn(() => '2026-07-15'),
}));

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { upsertRotationRange } from '@/app/(app)/calendario/actions';
import { copy } from '@/lib/copy';

type UpsertPayload = {
  user_id: string;
  fecha: string;
  estado_dia: string;
  es_estimado: boolean;
  motivo_ausencia: string | null;
  motivo_otros_texto: string | null;
};

function mockAdminSession() {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: 'admin-1',
    role: 'admin',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function mockSupabaseUpsert(handler: (fecha: string) => { message: string } | null = () => null) {
  const upsertMock = vi.fn((payload: UpsertPayload[], _options?: { onConflict: string }) =>
    Promise.resolve({ error: handler(payload[0].fecha) })
  );
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue({ from: fromMock } as any);
  return { upsertMock, fromMock };
}

describe('upsertRotationRange: gating de servidor (no-admin rechazado)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-admin: requireAdmin rechaza y el upsert NUNCA se invoca', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('NEXT_REDIRECT'));
    const { upsertMock } = mockSupabaseUpsert();

    await expect(
      upsertRotationRange({ user_id: 'emp-1', fechas: ['2026-07-10'], estado_dia: 'trabajando' })
    ).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('upsertRotationRange: rango feliz (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aplica el mismo estado a todos los días y reporta applied completo, sin fallidos', async () => {
    mockAdminSession();
    const { upsertMock, fromMock } = mockSupabaseUpsert();

    const result = await upsertRotationRange({
      user_id: 'emp-1',
      fechas: ['2026-07-10', '2026-07-11', '2026-07-12'],
      estado_dia: 'trabajando',
    });

    expect(result).toEqual({ applied: ['2026-07-10', '2026-07-11', '2026-07-12'], failed: [] });
    expect(fromMock).toHaveBeenCalledWith('rotation_assignments');
    expect(upsertMock).toHaveBeenCalledTimes(3);
    // Mismo mecanismo de pisado que la celda única: upsert con onConflict
    // user_id,fecha para cada día del rango.
    for (const call of upsertMock.mock.calls) {
      expect(call[1]).toEqual({ onConflict: 'user_id,fecha' });
    }
  });

  it('es_estimado por día: pasado/hoy = real (false), futuro = estimado (true), según getBusinessToday()', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert();

    await upsertRotationRange({
      user_id: 'emp-1',
      fechas: ['2026-07-10', '2026-07-15', '2026-07-20'],
      estado_dia: 'trabajando',
    });

    const payloads = upsertMock.mock.calls.map((c) => (c[0] as UpsertPayload[])[0]);
    expect(payloads.find((p) => p.fecha === '2026-07-10')?.es_estimado).toBe(false);
    expect(payloads.find((p) => p.fecha === '2026-07-15')?.es_estimado).toBe(false); // hoy = real
    expect(payloads.find((p) => p.fecha === '2026-07-20')?.es_estimado).toBe(true);
  });

  it('revalidatePath se llama cuando al menos un día se aplicó', async () => {
    mockAdminSession();
    mockSupabaseUpsert();

    await upsertRotationRange({ user_id: 'emp-1', fechas: ['2026-07-10'], estado_dia: 'trabajando' });

    expect(revalidatePath).toHaveBeenCalledWith('/calendario');
  });
});

describe('upsertRotationRange: fallo parcial (best-effort, sin abortar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('un día que falla no aborta el resto; el reporte lista ese día con su motivo legible', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert((fecha) =>
      fecha === '2026-07-11' ? { message: 'permission denied for table rotation_assignments' } : null
    );

    const result = await upsertRotationRange({
      user_id: 'emp-1',
      fechas: ['2026-07-10', '2026-07-11', '2026-07-12'],
      estado_dia: 'trabajando',
    });

    expect(result.applied).toEqual(['2026-07-10', '2026-07-12']);
    expect(result.failed).toEqual([
      { fecha: '2026-07-11', motivo: copy.calendario.range.errors.permisoDenegado },
    ]);
    expect(upsertMock).toHaveBeenCalledTimes(3);
  });

  it('reintentar es seguro: el mismo rango se puede volver a aplicar sin duplicar el reporte', async () => {
    mockAdminSession();
    mockSupabaseUpsert((fecha) => (fecha === '2026-07-11' ? { message: 'db error interno' } : null));

    const first = await upsertRotationRange({
      user_id: 'emp-1',
      fechas: ['2026-07-10', '2026-07-11'],
      estado_dia: 'trabajando',
    });
    expect(first.failed).toHaveLength(1);

    mockSupabaseUpsert(() => null); // el reintento ahora tiene éxito para todos
    const second = await upsertRotationRange({
      user_id: 'emp-1',
      fechas: ['2026-07-10', '2026-07-11'],
      estado_dia: 'trabajando',
    });
    expect(second).toEqual({ applied: ['2026-07-10', '2026-07-11'], failed: [] });
  });

  it('revalidatePath NO se llama si todos los días del rango fallan', async () => {
    mockAdminSession();
    mockSupabaseUpsert(() => ({ message: 'db error interno' }));

    await upsertRotationRange({ user_id: 'emp-1', fechas: ['2026-07-10'], estado_dia: 'trabajando' });

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('upsertRotationRange: validación previa a escribir (defensa en profundidad)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('periodo_fuera_trabajo sin motivo bloquea ANTES de llamar upsert para cualquier día', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert();

    await expect(
      upsertRotationRange({
        user_id: 'emp-1',
        fechas: ['2026-07-10', '2026-07-11'],
        estado_dia: 'periodo_fuera_trabajo',
      })
    ).rejects.toThrow(copy.calendario.errors.motivoRequerido);

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('periodo_fuera_trabajo con motivo "otros" sin texto bloquea antes de llamar upsert', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert();

    await expect(
      upsertRotationRange({
        user_id: 'emp-1',
        fechas: ['2026-07-10'],
        estado_dia: 'periodo_fuera_trabajo',
        motivo_ausencia: 'otros',
      })
    ).rejects.toThrow(copy.calendario.errors.motivoOtrosRequerido);

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('dia_tramite es rechazado con copy amigable, sin escribir ningún día (tiene su propio flujo gobernado)', async () => {
    mockAdminSession();
    const { upsertMock } = mockSupabaseUpsert();

    await expect(
      upsertRotationRange({
        user_id: 'emp-1',
        fechas: ['2026-07-10', '2026-07-11'],
        estado_dia: 'periodo_fuera_trabajo',
        motivo_ausencia: 'dia_tramite',
      })
    ).rejects.toThrow(copy.calendario.range.errors.diaTramiteNoDisponible);

    expect(upsertMock).not.toHaveBeenCalled();
  });
});
