/**
 * FB-F5-06 — Server Actions del módulo Procedimientos
 * (crearProcedimiento / actualizarProcedimiento / cambiarEstadoProcedimiento)
 *
 * Cubre, con supabase SIEMPRE mockeado (nada toca la red ni Postgres real —
 * las RPCs en sí ya están probadas contra Postgres real en
 * tests/integration/procedimientos-rpc.test.ts):
 *  - Contrato return-based: nunca throw, siempre { ok, ... } | { ok:false, error }.
 *  - Exclusividad de contenido (texto XOR archivo), impuesta acá, no en la base.
 *  - Validación de archivo (tipo/tamaño) del lado del server.
 *  - Reemplazo de archivo en actualizar: sube el nuevo, borra el viejo
 *    best-effort, y el flag `mantener_archivo_actual` evita re-subir cuando
 *    no se elige un archivo nuevo.
 *  - Limpieza best-effort del archivo subido si la RPC falla después.
 *  - Límite de rol (admin / supervisor / empleado) en las tres actions.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import {
  crearProcedimiento,
  actualizarProcedimiento,
  cambiarEstadoProcedimiento,
} from '@/app/(app)/procedimientos/actions';
import { copy } from '@/lib/copy';

type MockOptions = {
  role?: string;
  userId?: string;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  currentRow?: { file_path: string | null } | null;
  currentRowError?: { message: string } | null;
  uploadError?: { message: string } | null;
  removeError?: { message: string } | null;
};

function makeServerClient(opts: MockOptions = {}) {
  const {
    role = 'admin',
    userId = 'admin-id',
    rpcData = 'new-procedure-id',
    rpcError = null,
    currentRow = { file_path: null },
    currentRowError = null,
    uploadError = null,
    removeError = null,
  } = opts;

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

  const uploadMock = vi.fn().mockResolvedValue({ error: uploadError });
  const removeMock = vi.fn().mockResolvedValue({ error: removeError });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: profile, error: null }),
            })),
          })),
        };
      }
      if (table === 'procedures') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: currentRow, error: currentRowError }),
            })),
          })),
        };
      }
      throw new Error(`tabla no mockeada en el test: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        remove: removeMock,
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
      })),
    },
    __uploadMock: uploadMock,
    __removeMock: removeMock,
  };
}

function mockClient(opts: MockOptions = {}) {
  const client = makeServerClient(opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createServerClient).mockResolvedValue(client as any);
  return client;
}

function pdfFile(name = 'manual.pdf', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

function textFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── crearProcedimiento ───────────────────────────────────────────

describe('crearProcedimiento: happy path', () => {
  it('con contenido_texto: invoca la RPC con p_file_path=null y devuelve { ok:true, id }', async () => {
    const client = mockClient();

    const result = await crearProcedimiento(
      textFormData({ titulo: 'Manual', categoria: 'Seguridad', contenido_texto: 'Contenido real' })
    );

    expect(client.rpc).toHaveBeenCalledWith(
      'crear_procedimiento',
      expect.objectContaining({
        p_titulo: 'Manual',
        p_categoria: 'Seguridad',
        p_contenido_texto: 'Contenido real',
        p_file_path: null,
      })
    );
    expect(result).toEqual({ ok: true, id: 'new-procedure-id' });
  });

  it('con archivo: sube el archivo, invoca la RPC con p_contenido_texto=null y el path subido', async () => {
    const client = mockClient();
    const fd = textFormData({ titulo: 'Manual', categoria: '' });
    fd.set('file', pdfFile());

    const result = await crearProcedimiento(fd);

    expect(client.__uploadMock).toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith(
      'crear_procedimiento',
      expect.objectContaining({ p_titulo: 'Manual', p_contenido_texto: null })
    );
    const rpcArgs = client.rpc.mock.calls[0][1] as { p_file_path: string };
    expect(rpcArgs.p_file_path).toMatch(/manual\.pdf$/);
    expect(result).toEqual({ ok: true, id: 'new-procedure-id' });
  });
});

describe('crearProcedimiento: exclusividad de contenido', () => {
  it('texto Y archivo a la vez → rechaza sin invocar la RPC', async () => {
    const client = mockClient();
    const fd = textFormData({ titulo: 'Manual', contenido_texto: 'Contenido' });
    fd.set('file', pdfFile());

    const result = await crearProcedimiento(fd);

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.contenidoExclusivo });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('ni texto ni archivo → rechaza sin invocar la RPC', async () => {
    const client = mockClient();

    const result = await crearProcedimiento(textFormData({ titulo: 'Manual' }));

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.contenidoRequerido });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('título vacío → rechaza sin invocar la RPC', async () => {
    const client = mockClient();

    const result = await crearProcedimiento(textFormData({ titulo: '  ', contenido_texto: 'x' }));

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.tituloRequerido });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('crearProcedimiento: validación de archivo del lado del server', () => {
  it('tipo de archivo no permitido → rechaza sin subir ni invocar la RPC', async () => {
    const client = mockClient();
    const fd = textFormData({ titulo: 'Manual' });
    fd.set('file', new File(['x'], 'malware.exe', { type: 'application/x-msdownload' }));

    const result = await crearProcedimiento(fd);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('no permitido');
    expect(client.__uploadMock).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('archivo demasiado grande → rechaza sin subir ni invocar la RPC', async () => {
    const client = mockClient();
    const fd = textFormData({ titulo: 'Manual' });
    fd.set('file', pdfFile('grande.pdf', 10 * 1024 * 1024 + 1));

    const result = await crearProcedimiento(fd);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('límite de 10 MB');
    expect(client.__uploadMock).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('crearProcedimiento: la RPC falla después de subir un archivo', () => {
  it('limpia el archivo subido (best-effort) y devuelve el error genérico', async () => {
    const client = mockClient({ rpcError: { message: 'CHECK violado' } });
    const fd = textFormData({ titulo: 'Manual' });
    fd.set('file', pdfFile());

    const result = await crearProcedimiento(fd);

    expect(client.__uploadMock).toHaveBeenCalled();
    expect(client.__removeMock).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.generic });
  });

  it('si además falla la limpieza, igual devuelve el error de la RPC (no crashea)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = mockClient({
      rpcError: { message: 'CHECK violado' },
      removeError: { message: 'bucket caído' },
    });
    const fd = textFormData({ titulo: 'Manual' });
    fd.set('file', pdfFile());

    const result = await crearProcedimiento(fd);

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.generic });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ─── actualizarProcedimiento ──────────────────────────────────────

describe('actualizarProcedimiento: happy path', () => {
  it('cambia de archivo a texto: la RPC recibe el texto nuevo, y el archivo viejo se borra best-effort', async () => {
    const client = mockClient({ currentRow: { file_path: 'old-uuid/viejo.pdf' } });

    const result = await actualizarProcedimiento(
      'proc-1',
      textFormData({ titulo: 'Actualizado', contenido_texto: 'Texto nuevo' })
    );

    expect(client.rpc).toHaveBeenCalledWith(
      'actualizar_procedimiento',
      expect.objectContaining({ p_id: 'proc-1', p_contenido_texto: 'Texto nuevo', p_file_path: null })
    );
    expect(client.__removeMock).toHaveBeenCalledWith(['old-uuid/viejo.pdf']);
    expect(result).toEqual({ ok: true });
  });

  it('mantener_archivo_actual=1: NO sube nada, reenvía el file_path actual, NO borra nada', async () => {
    const client = mockClient({ currentRow: { file_path: 'old-uuid/actual.pdf' } });
    const fd = textFormData({ titulo: 'Actualizado', mantener_archivo_actual: '1' });

    const result = await actualizarProcedimiento('proc-1', fd);

    expect(client.__uploadMock).not.toHaveBeenCalled();
    expect(client.__removeMock).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith(
      'actualizar_procedimiento',
      expect.objectContaining({ p_file_path: 'old-uuid/actual.pdf', p_contenido_texto: null })
    );
    expect(result).toEqual({ ok: true });
  });

  it('reemplaza un archivo por otro: sube el nuevo y borra el viejo (paths distintos)', async () => {
    const client = mockClient({ currentRow: { file_path: 'old-uuid/viejo.pdf' } });
    const fd = textFormData({ titulo: 'Actualizado' });
    fd.set('file', pdfFile('nuevo.pdf'));

    const result = await actualizarProcedimiento('proc-1', fd);

    expect(client.__uploadMock).toHaveBeenCalled();
    expect(client.__removeMock).toHaveBeenCalledWith(['old-uuid/viejo.pdf']);
    expect(result).toEqual({ ok: true });
  });

  it('no había archivo viejo: no intenta borrar nada', async () => {
    const client = mockClient({ currentRow: { file_path: null } });

    await actualizarProcedimiento('proc-1', textFormData({ titulo: 'Actualizado', contenido_texto: 'Texto' }));

    expect(client.__removeMock).not.toHaveBeenCalled();
  });
});

describe('actualizarProcedimiento: casos de error', () => {
  it('exclusividad: texto y archivo a la vez → rechaza sin leer la fila actual ni invocar la RPC', async () => {
    const client = mockClient();
    const fd = textFormData({ titulo: 'X', contenido_texto: 'texto' });
    fd.set('file', pdfFile());

    const result = await actualizarProcedimiento('proc-1', fd);

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.contenidoExclusivo });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('la fila no existe → error noEncontrado, no invoca la RPC', async () => {
    const client = mockClient({ currentRow: null, currentRowError: { message: 'not found' } });

    const result = await actualizarProcedimiento(
      'proc-inexistente',
      textFormData({ titulo: 'X', contenido_texto: 'texto' })
    );

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.noEncontrado });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('mantener_archivo_actual=1 pero no había archivo viejo → error de contenido requerido', async () => {
    const client = mockClient({ currentRow: { file_path: null } });
    const fd = textFormData({ titulo: 'X', mantener_archivo_actual: '1' });

    const result = await actualizarProcedimiento('proc-1', fd);

    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.contenidoRequerido });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('la RPC falla tras subir un archivo nuevo: limpia el nuevo (no el viejo, que sigue vigente)', async () => {
    const client = mockClient({
      currentRow: { file_path: 'old-uuid/viejo.pdf' },
      rpcError: { message: 'error' },
    });
    const fd = textFormData({ titulo: 'X' });
    fd.set('file', pdfFile('nuevo.pdf'));

    const result = await actualizarProcedimiento('proc-1', fd);

    expect(client.__removeMock).toHaveBeenCalledTimes(1);
    const removedPaths = client.__removeMock.mock.calls[0][0] as string[];
    expect(removedPaths[0]).toMatch(/nuevo\.pdf$/);
    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.generic });
  });
});

// ─── cambiarEstadoProcedimiento ───────────────────────────────────

describe('cambiarEstadoProcedimiento', () => {
  it('archiva: invoca la RPC con el estado pedido y devuelve { ok:true }', async () => {
    const client = mockClient();

    const result = await cambiarEstadoProcedimiento('proc-1', 'archivado');

    expect(client.rpc).toHaveBeenCalledWith('archivar_procedimiento', { p_id: 'proc-1', p_estado: 'archivado' });
    expect(result).toEqual({ ok: true });
  });

  it('restaura: invoca la RPC con estado vigente', async () => {
    const client = mockClient();

    await cambiarEstadoProcedimiento('proc-1', 'vigente');

    expect(client.rpc).toHaveBeenCalledWith('archivar_procedimiento', { p_id: 'proc-1', p_estado: 'vigente' });
  });

  it('error de la RPC: devuelve el error genérico, no lo tira', async () => {
    const client = mockClient({ rpcError: { message: 'guarda falló' } });

    const result = await cambiarEstadoProcedimiento('proc-1', 'archivado');

    expect(client.rpc).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: copy.procedimientos.errors.generic });
  });
});

// ─── Límite de rol ─────────────────────────────────────────────────
//
// FB-F5-AUD-05 Hallazgo 3: estas aserciones NO son un vacío de cobertura
// del contrato { ok } — son la prueba de la excepción documentada al
// principio de actions.ts. Un no-admin que llama cualquiera de las tres
// actions tiene que terminar en redirect('/dashboard'), nunca en
// { ok: false, error: '...' }: el guard de rol corta antes de llegar al
// contrato return-based, a propósito.

describe('límite de rol (admin / supervisor / empleado) — redirect() es el comportamiento esperado, no un throw a envolver', () => {
  it('admin: pasa el guard, NO redirige a /dashboard en ninguna de las tres actions', async () => {
    mockClient({ role: 'admin', userId: 'admin-id' });

    await crearProcedimiento(textFormData({ titulo: 'X', contenido_texto: 'y' }));
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');

    vi.clearAllMocks();
    mockClient({ role: 'admin', userId: 'admin-id', currentRow: { file_path: null } });
    await actualizarProcedimiento('proc-1', textFormData({ titulo: 'X', contenido_texto: 'y' }));
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');

    vi.clearAllMocks();
    mockClient({ role: 'admin', userId: 'admin-id' });
    await cambiarEstadoProcedimiento('proc-1', 'archivado');
    expect(redirect).not.toHaveBeenCalledWith('/dashboard');
  });

  it('supervisor: el guard de rol corta por redirect() — comportamiento correcto, no un error de negocio a devolver como { ok:false }', async () => {
    mockClient({ role: 'supervisor', userId: 'sup-id' });
    await crearProcedimiento(textFormData({ titulo: 'X', contenido_texto: 'y' }));
    expect(redirect).toHaveBeenCalledWith('/dashboard');

    vi.clearAllMocks();
    mockClient({ role: 'supervisor', userId: 'sup-id', currentRow: { file_path: null } });
    await actualizarProcedimiento('proc-1', textFormData({ titulo: 'X', contenido_texto: 'y' }));
    expect(redirect).toHaveBeenCalledWith('/dashboard');

    vi.clearAllMocks();
    mockClient({ role: 'supervisor', userId: 'sup-id' });
    await cambiarEstadoProcedimiento('proc-1', 'archivado');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('empleado: el guard de rol corta por redirect() — comportamiento correcto, no un error de negocio a devolver como { ok:false }', async () => {
    mockClient({ role: 'empleado', userId: 'emp-id' });
    await crearProcedimiento(textFormData({ titulo: 'X', contenido_texto: 'y' }));
    expect(redirect).toHaveBeenCalledWith('/dashboard');

    vi.clearAllMocks();
    mockClient({ role: 'empleado', userId: 'emp-id', currentRow: { file_path: null } });
    await actualizarProcedimiento('proc-1', textFormData({ titulo: 'X', contenido_texto: 'y' }));
    expect(redirect).toHaveBeenCalledWith('/dashboard');

    vi.clearAllMocks();
    mockClient({ role: 'empleado', userId: 'emp-id' });
    await cambiarEstadoProcedimiento('proc-1', 'archivado');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
