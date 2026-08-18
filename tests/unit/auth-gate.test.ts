/**
 * FB-F5-08 — Gate de acceso en requireAuth(): solo profiles.status='activo'
 * entra. `inactivo` se expulsa aunque el JWT siga siendo técnicamente
 * válido (p.ej. alguien inactivado mientras ya navegaba) —
 * cubre la parte "mockeable" del gate (redirect + signOut invocados con lo
 * esperado). El caso de sesión real cortada por revocación de Supabase
 * Auth se verifica contra Postgres/Auth real en
 * tests/e2e/gestion-usuarios.spec.ts (no se puede simular con mocks).
 *
 * El mock global de next/navigation (tests/setup.ts) es un no-op — a
 * diferencia del redirect() real de Next (tipado `never`: siempre tira
 * para cortar el render, y por eso TypeScript angosta `user`/`profile` a
 * non-null justo después de cada `if (...) redirect(...)` en lib/auth.ts).
 * Acá se sobreescribe el mock para que SÍ tire, como en producción —
 * si no, el guard de acceso sin sesión/sin perfil (ya existente, sin
 * cambios de FB-F5-08) revienta con un TypeError al deferenciar null.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth, requireAdmin } from '@/lib/auth';

const NEXT_REDIRECT = 'NEXT_REDIRECT';

type MockOptions = {
  hasUser?: boolean;
  hasProfile?: boolean;
  status?: string;
  role?: string;
};

function makeClient(opts: MockOptions = {}) {
  const { hasUser = true, hasProfile = true, status = 'activo', role = 'admin' } = opts;

  const profile = hasProfile
    ? { id: 'user-1', email: 'user@test.com', full_name: 'Test User', role, status }
    : null;

  const signOut = vi.fn().mockResolvedValue({ error: null });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: hasUser ? { id: 'user-1' } : null } }),
      signOut,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        })),
      })),
    })),
    __signOut: signOut,
  };
}

function mockClient(opts: MockOptions = {}) {
  const client = makeClient(opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(redirect).mockImplementation(() => {
    throw new Error(NEXT_REDIRECT);
  });
});

describe('requireAuth: status activo entra sin fricción', () => {
  it('devuelve el perfil, no redirige, no cierra sesión', async () => {
    mockClient({ status: 'activo' });
    const profile = await requireAuth();
    expect(profile.status).toBe('activo');
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('requireAuth: gate de status (FB-F5-08)', () => {
  it('inactivo: cierra la sesión ANTES de redirigir a /login con motivo genérico', async () => {
    const client = mockClient({ status: 'inactivo' });
    await expect(requireAuth()).rejects.toThrow(NEXT_REDIRECT);
    expect(client.__signOut).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/login?motivo=acceso');
  });

  it('caso "inactivado con sesión abierta": el JWT sigue siendo válido (hasUser=true) pero status ya es inactivo — igual se expulsa', async () => {
    const client = mockClient({ hasUser: true, hasProfile: true, status: 'inactivo' });
    await expect(requireAuth()).rejects.toThrow(NEXT_REDIRECT);
    expect(client.__signOut).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/login?motivo=acceso');
  });
});

describe('requireAuth: casos preexistentes sin cambios (sin sesión / sin perfil)', () => {
  it('sin user: redirige a /login sin llamar signOut (no hay sesión que cerrar)', async () => {
    const client = mockClient({ hasUser: false });
    await expect(requireAuth()).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith('/login');
    expect(client.__signOut).not.toHaveBeenCalled();
  });

  it('sin perfil: redirige a /login sin llamar signOut', async () => {
    const client = mockClient({ hasProfile: false });
    await expect(requireAuth()).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith('/login');
    expect(client.__signOut).not.toHaveBeenCalled();
  });
});

describe('requireAdmin: el gate de status corre antes que el de rol', () => {
  it('admin inactivo: se expulsa por status, no llega a evaluarse el rol', async () => {
    const client = mockClient({ status: 'inactivo', role: 'admin' });
    await expect(requireAdmin()).rejects.toThrow(NEXT_REDIRECT);
    expect(client.__signOut).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/login?motivo=acceso');
  });
});
