import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateDocumentFile, DOCUMENTS_BUCKET } from '@/lib/storage';

// ─── validateDocumentFile ─────────────────────────────────────
// FB-F4-19: devuelve { ok, error } en vez de tirar (lib/storage.ts).

describe('validateDocumentFile', () => {
  it('acepta archivos de tipo permitido dentro del límite', () => {
    expect(validateDocumentFile({ size: 1024, type: 'application/pdf' })).toEqual({ ok: true });
    expect(validateDocumentFile({ size: 1024, type: 'image/jpeg' })).toEqual({ ok: true });
    expect(validateDocumentFile({ size: 1024, type: 'image/png' })).toEqual({ ok: true });
  });

  it('rechaza archivos que superan 10 MB', () => {
    const result = validateDocumentFile({ size: 10 * 1024 * 1024 + 1, type: 'application/pdf' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('límite de 10 MB');
  });

  it('rechaza archivos de tipo no permitido', () => {
    for (const type of ['application/zip', 'text/html', 'application/javascript']) {
      const result = validateDocumentFile({ size: 100, type });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('no permitido');
    }
  });

  it('acepta exactamente 10 MB', () => {
    expect(validateDocumentFile({ size: 10 * 1024 * 1024, type: 'application/pdf' })).toEqual({ ok: true });
  });
});

// ─── createSignedUrl ─────────────────────────────────────────
// FB-F4-19: devuelve { ok, url } | { ok:false, error } en vez de tirar.

describe('createSignedUrl', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('retorna la signedUrl del bucket privado (mocked)', async () => {
    const mockSignedUrl = 'https://supabase.co/storage/v1/sign/documents/user-1/doc.pdf?token=abc';

    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        storage: {
          from: (bucket: string) => {
            expect(bucket).toBe(DOCUMENTS_BUCKET);
            return {
              createSignedUrl: vi.fn().mockResolvedValue({
                data: { signedUrl: mockSignedUrl },
                error: null,
              }),
            };
          },
        },
      }),
    }));

    const { createSignedUrl } = await import('@/lib/storage');
    const result = await createSignedUrl('user-1/doc.pdf');
    expect(result).toEqual({ ok: true, url: mockSignedUrl });
  });

  it('devuelve {ok:false} si Supabase Storage devuelve error', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        storage: {
          from: () => ({
            createSignedUrl: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Bucket not found' },
            }),
          }),
        },
      }),
    }));

    const { createSignedUrl } = await import('@/lib/storage');
    await expect(createSignedUrl('user-1/missing.pdf')).resolves.toEqual({
      ok: false,
      error: 'Bucket not found',
    });
  });

  it('devuelve {ok:false} si no hay signedUrl en la respuesta', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        storage: {
          from: () => ({
            createSignedUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: null },
              error: null,
            }),
          }),
        },
      }),
    }));

    const { createSignedUrl } = await import('@/lib/storage');
    const result = await createSignedUrl('user-1/broken.pdf');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('No se pudo generar la URL');
  });

  it('las URLs son privadas (no usan el bucket público)', async () => {
    // El bucket DOCUMENTS_BUCKET debe ser 'documents', configurado como privado en la migración
    expect(DOCUMENTS_BUCKET).toBe('documents');
  });
});
