/**
 * Tests de límite de rol en servidor — Módulo Mi Equipo (FB-F2-04)
 *
 * Ejercita requireSupervisor() directamente con perfiles de distintos roles,
 * verificando que admin y empleado reciben redirect a /dashboard
 * y que supervisor pasa sin redirección. Test 4 del requisito RLS end-to-end.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mockear el cliente de servidor ANTES de importar requireSupervisor
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireSupervisor } from '@/lib/auth';

function mockClientForRole(role: string, userId = 'test-user-id') {
  const profile = {
    id: userId,
    email: `${role}@test.com`,
    full_name: `Test ${role}`,
    role,
    status: 'activo',
    supervisor_id: null,
    phone: null,
    cuit: null,
    winda_id: null,
    dni: null,
    fecha_ingreso: null,
    entrevista_tecnica: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        }),
      }),
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(mockClient as any);
}

describe('requireSupervisor: límite de rol en servidor para /mi-equipo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin recibe redirect a /dashboard al intentar acceder', async () => {
    mockClientForRole('admin', 'admin-id');
    await requireSupervisor();
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado recibe redirect a /dashboard al intentar acceder', async () => {
    mockClientForRole('empleado', 'emp-id');
    await requireSupervisor();
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('supervisor NO recibe redirect a /dashboard (acceso permitido)', async () => {
    mockClientForRole('supervisor', 'sup-id');
    await requireSupervisor();
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });
});
