import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateDocumentFile, DOCUMENTS_BUCKET } from '@/lib/storage';

// ─── validateDocumentFile ─────────────────────────────────────

describe('validateDocumentFile', () => {
  it('acepta archivos de tipo permitido dentro del límite', () => {
    expect(() =>
      validateDocumentFile({ size: 1024, type: 'application/pdf' })
    ).not.toThrow();

    expect(() =>
      validateDocumentFile({ size: 1024, type: 'image/jpeg' })
    ).not.toThrow();

    expect(() =>
      validateDocumentFile({ size: 1024, type: 'image/png' })
    ).not.toThrow();
  });

  it('rechaza archivos que superan 10 MB', () => {
    expect(() =>
      validateDocumentFile({ size: 10 * 1024 * 1024 + 1, type: 'application/pdf' })
    ).toThrow('límite de 10 MB');
  });

  it('rechaza archivos de tipo no permitido', () => {
    expect(() =>
      validateDocumentFile({ size: 100, type: 'application/zip' })
    ).toThrow('no permitido');

    expect(() =>
      validateDocumentFile({ size: 100, type: 'text/html' })
    ).toThrow('no permitido');

    expect(() =>
      validateDocumentFile({ size: 100, type: 'application/javascript' })
    ).toThrow('no permitido');
  });

  it('acepta exactamente 10 MB', () => {
    expect(() =>
      validateDocumentFile({ size: 10 * 1024 * 1024, type: 'application/pdf' })
    ).not.toThrow();
  });
});

// ─── createSignedUrl ─────────────────────────────────────────

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
    const url = await createSignedUrl('user-1/doc.pdf');
    expect(url).toBe(mockSignedUrl);
  });

  it('lanza error si Supabase Storage devuelve error', async () => {
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
    await expect(createSignedUrl('user-1/missing.pdf')).rejects.toThrow('Bucket not found');
  });

  it('lanza error si no hay signedUrl en la respuesta', async () => {
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
    await expect(createSignedUrl('user-1/broken.pdf')).rejects.toThrow(
      'No se pudo generar la URL'
    );
  });

  it('las URLs son privadas (no usan el bucket público)', async () => {
    // El bucket DOCUMENTS_BUCKET debe ser 'documents', configurado como privado en la migración
    expect(DOCUMENTS_BUCKET).toBe('documents');
  });
});
