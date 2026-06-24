/**
 * Tests de límite de rol en servidor — Módulo Equipo (FB-F2-02, hallazgo #1)
 *
 * Ejercita requireAdmin() directamente con perfiles de distintos roles,
 * verificando que supervisor y empleado reciben redirect a /dashboard
 * y que admin pasa sin redirección. No usa solo canAccess; llama el
 * código real de autorización con un cliente Supabase mockeado.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mockear el cliente de servidor ANTES de importar requireAdmin
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';

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

describe('requireAdmin: límite de rol en servidor para /equipo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supervisor recibe redirect a /dashboard al intentar acceder', async () => {
    mockClientForRole('supervisor', 'sup-id');
    await requireAdmin();
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado recibe redirect a /dashboard al intentar acceder', async () => {
    mockClientForRole('empleado', 'emp-id');
    await requireAdmin();
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('admin NO recibe redirect a /dashboard (acceso permitido)', async () => {
    mockClientForRole('admin', 'admin-id');
    await requireAdmin();
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });

});
