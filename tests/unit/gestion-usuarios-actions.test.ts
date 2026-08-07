/**
 * FB-F5-08 — Server Actions de Gestión de Usuarios
 * (createUser / updateUser / deactivateUser / activateUser / resetPassword)
 *
 * Cubre, con supabase SIEMPRE mockeado (nada toca la red ni Postgres real):
 *  - Contrato return-based: nunca throw, siempre { ok, ... } | { ok:false, error }.
 *  - Límite de rol (admin-only) en las cinco actions — sabotaje verificado
 *    a mano (ver docs/prompts/FB-F5-08.md, reporte de cierre): comentar el
 *    `await requireAdmin()` de una action hace fallar el test de esa action,
 *    revertido después con `git diff` vacío.
 *  - Alta: status='activo' explícito (no el DEFAULT de la columna).
 *  - Reseteo de contraseña: admin client solo después de requireAdmin(),
 *    audit_log con actor_id del admin (no NULL, no el del usuario afectado).
 *  - Baja: motivo y fecha obligatorios del lado del server (no solo el form).
 *  - Reactivar: limpia motivo_baja/fecha_baja.
 *  - Validación de contraseña compartida (lib/password.ts) en alta y reseteo.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  resetPassword,
} from '@/app/(app)/gestion-usuarios/actions';
import { copy } from '@/lib/copy';

// ─── Mock del cliente de sesión (requireAdmin) ─────────────────

function mockSessionClient(role = 'admin', userId = 'admin-1') {
  const profile = { id: userId, email: `${role}@test.com`, full_name: `Test ${role}`, role, status: 'activo' };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        })),
      })),
    })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return client;
}

// ─── Mock del admin client (service_role) ──────────────────────

type AdminOptions = {
  createUserError?: { message: string } | null;
  updateUserByIdError?: { message: string } | null;
  profileUpdateError?: { message: string } | null;
  auditInsertError?: { message: string } | null;
};

function mockAdminClient(opts: AdminOptions = {}) {
  const {
    createUserError = null,
    updateUserByIdError = null,
    profileUpdateError = null,
    auditInsertError = null,
  } = opts;

  const profileUpdateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: profileUpdateError }),
  });
  const auditInsertMock = vi.fn().mockResolvedValue({ error: auditInsertError });
  const createUserMock = vi.fn().mockResolvedValue(
    createUserError ? { data: null, error: createUserError } : { data: { user: { id: 'new-user-id' } }, error: null }
  );
  const updateUserByIdMock = vi.fn().mockResolvedValue({ data: {}, error: updateUserByIdError });

  const client = {
    auth: { admin: { createUser: createUserMock, updateUserById: updateUserByIdMock } },
    from: vi.fn((table: string) => {
      if (table === 'profiles') return { update: profileUpdateMock };
      if (table === 'audit_log') return { insert: auditInsertMock };
      throw new Error(`tabla no mockeada en el test: ${table}`);
    }),
    __profileUpdateMock: profileUpdateMock,
    __auditInsertMock: auditInsertMock,
    __createUserMock: createUserMock,
    __updateUserByIdMock: updateUserByIdMock,
  };

  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return client;
}

const VALID_PASSWORD = 'Contrasena1';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createUser ─────────────────────────────────────────────────

describe('createUser', () => {
  it('happy path: status activo explícito, sin tocar audit_log (fuera de alcance de FB-F5-08)', async () => {
    mockSessionClient('admin');
    const admin = mockAdminClient();

    const result = await createUser({
      email: 'nuevo@test.com',
      full_name: 'Nuevo Usuario',
      role: 'empleado',
      initial_password: VALID_PASSWORD,
    });

    expect(result).toEqual({ ok: true, id: 'new-user-id' });
    expect(admin.__profileUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'activo' })
    );
  });

  it('rechaza contraseña débil sin llegar a llamar auth.admin.createUser', async () => {
    mockSessionClient('admin');
    const admin = mockAdminClient();

    const result = await createUser({
      email: 'nuevo@test.com',
      full_name: 'Nuevo Usuario',
      role: 'empleado',
      initial_password: 'corta1A',
    });

    expect(result.ok).toBe(false);
    expect(admin.__createUserMock).not.toHaveBeenCalled();
  });

  it('propaga el error de Supabase Auth sin throw', async () => {
    mockSessionClient('admin');
    mockAdminClient({ createUserError: { message: 'email ya registrado' } });

    const result = await createUser({
      email: 'dup@test.com',
      full_name: 'Dup',
      role: 'empleado',
      initial_password: VALID_PASSWORD,
    });

    expect(result).toEqual({ ok: false, error: 'email ya registrado' });
  });
});

// ─── resetPassword ──────────────────────────────────────────────

describe('resetPassword', () => {
  it('happy path: llama updateUserById y registra audit_log con el actor_id del admin (no del usuario afectado, no NULL)', async () => {
    mockSessionClient('admin', 'admin-42');
    const admin = mockAdminClient();

    const result = await resetPassword('usuario-afectado-99', VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
    expect(admin.__updateUserByIdMock).toHaveBeenCalledWith('usuario-afectado-99', { password: VALID_PASSWORD });
    expect(admin.__auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'admin-42',
        action: 'password_reset',
        table_name: 'profiles',
        record_id: 'usuario-afectado-99',
      })
    );
    // actor_id nunca es el del usuario afectado ni NULL
    const auditPayload = admin.__auditInsertMock.mock.calls[0][0];
    expect(auditPayload.actor_id).not.toBe('usuario-afectado-99');
    expect(auditPayload.actor_id).toBeTruthy();
  });

  it('rechaza contraseña débil sin llegar a llamar updateUserById ni tocar audit_log', async () => {
    mockSessionClient('admin', 'admin-42');
    const admin = mockAdminClient();

    const result = await resetPassword('usuario-99', 'debil');

    expect(result.ok).toBe(false);
    expect(admin.__updateUserByIdMock).not.toHaveBeenCalled();
    expect(admin.__auditInsertMock).not.toHaveBeenCalled();
  });

  it('la contraseña cambia aunque el registro en audit_log falle (no bloqueante, ya está documentado en el código)', async () => {
    mockSessionClient('admin', 'admin-42');
    const admin = mockAdminClient({ auditInsertError: { message: 'boom' } });

    const result = await resetPassword('usuario-99', VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
    expect(admin.__updateUserByIdMock).toHaveBeenCalled();
  });

  it('propaga el error de Supabase Auth sin throw', async () => {
    mockSessionClient('admin', 'admin-42');
    mockAdminClient({ updateUserByIdError: { message: 'usuario no encontrado' } });

    const result = await resetPassword('usuario-99', VALID_PASSWORD);
    expect(result).toEqual({ ok: false, error: 'usuario no encontrado' });
  });
});

// ─── deactivateUser ─────────────────────────────────────────────

describe('deactivateUser', () => {
  it('happy path: guarda status/motivo_baja/fecha_baja y registra audit_log', async () => {
    mockSessionClient('admin', 'admin-42');
    const admin = mockAdminClient();

    const result = await deactivateUser({ id: 'user-1', motivo: 'Renuncia', fecha: '2026-08-07' });

    expect(result).toEqual({ ok: true });
    expect(admin.__profileUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'inactivo', motivo_baja: 'Renuncia', fecha_baja: '2026-08-07' })
    );
    expect(admin.__auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor_id: 'admin-42', action: 'user_deactivated', record_id: 'user-1' })
    );
  });

  it('rechaza sin motivo, del lado del server, sin tocar la base', async () => {
    mockSessionClient('admin');
    const admin = mockAdminClient();

    const result = await deactivateUser({ id: 'user-1', motivo: '   ', fecha: '2026-08-07' });

    expect(result).toEqual({ ok: false, error: copy.gestionUsuarios.bajaModal.motivoRequired });
    expect(admin.__profileUpdateMock).not.toHaveBeenCalled();
  });

  it('rechaza sin fecha, del lado del server, sin tocar la base', async () => {
    mockSessionClient('admin');
    const admin = mockAdminClient();

    const result = await deactivateUser({ id: 'user-1', motivo: 'Renuncia', fecha: '' });

    expect(result).toEqual({ ok: false, error: copy.gestionUsuarios.bajaModal.fechaRequired });
    expect(admin.__profileUpdateMock).not.toHaveBeenCalled();
  });
});

// ─── activateUser ───────────────────────────────────────────────

describe('activateUser', () => {
  it('happy path: limpia motivo_baja/fecha_baja y registra audit_log', async () => {
    mockSessionClient('admin', 'admin-42');
    const admin = mockAdminClient();

    const result = await activateUser('user-1');

    expect(result).toEqual({ ok: true });
    expect(admin.__profileUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'activo', motivo_baja: null, fecha_baja: null })
    );
    expect(admin.__auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor_id: 'admin-42', action: 'user_activated', record_id: 'user-1' })
    );
  });
});

// ─── Límite de rol (admin-only) — redirect() es el comportamiento esperado ──
// Mismo patrón que procedimientos/actions.ts: requireAdmin() corta por
// redirect('/dashboard'), no por { ok:false }. Si se saca el `await
// requireAdmin()` de alguna de estas cinco actions, el test correspondiente
// deja de ver el redirect y falla — verificado a mano (ver reporte de cierre).

describe('límite de rol: supervisor y empleado no pueden ejecutar ninguna de las cinco actions', () => {
  it('createUser', async () => {
    mockSessionClient('supervisor', 'sup-1');
    mockAdminClient();
    await createUser({ email: 'x@test.com', full_name: 'X', role: 'empleado', initial_password: VALID_PASSWORD });
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('updateUser', async () => {
    mockSessionClient('empleado', 'emp-1');
    mockAdminClient();
    await updateUser({ id: 'user-1', full_name: 'X', role: 'empleado' });
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('deactivateUser', async () => {
    mockSessionClient('supervisor', 'sup-1');
    mockAdminClient();
    await deactivateUser({ id: 'user-1', motivo: 'x', fecha: '2026-08-07' });
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('activateUser', async () => {
    mockSessionClient('empleado', 'emp-1');
    mockAdminClient();
    await activateUser('user-1');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('resetPassword', async () => {
    mockSessionClient('supervisor', 'sup-1');
    mockAdminClient();
    await resetPassword('user-1', VALID_PASSWORD);
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
