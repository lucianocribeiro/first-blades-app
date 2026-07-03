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
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { upsertRotationAssignment } from '@/app/(app)/calendario/actions';
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
