/**
 * FB-F5-06 — lib/storage.ts: validación de archivo para procedimientos
 * (bucket 'procedimientos'). Cubre tipo permitido/no permitido y tamaño,
 * del lado del server — la misma validación que corre dentro de
 * uploadProcedureFile antes de tocar Storage.
 */
import { describe, it, expect } from 'vitest';
import { validateProcedureFile, PROCEDURES_BUCKET } from '@/lib/storage';

describe('validateProcedureFile', () => {
  it('acepta PDF, Word (.doc/.docx) y texto plano dentro del límite', () => {
    expect(validateProcedureFile({ size: 1024, type: 'application/pdf' })).toEqual({ ok: true });
    expect(validateProcedureFile({ size: 1024, type: 'application/msword' })).toEqual({ ok: true });
    expect(
      validateProcedureFile({
        size: 1024,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toEqual({ ok: true });
    expect(validateProcedureFile({ size: 1024, type: 'text/plain' })).toEqual({ ok: true });
  });

  it('rechaza tipos que sí acepta el bucket documents pero no procedimientos (imágenes)', () => {
    const result = validateProcedureFile({ size: 1024, type: 'image/jpeg' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('no permitido');
  });

  it('rechaza tipos claramente no permitidos', () => {
    for (const type of ['application/zip', 'text/html', 'application/javascript']) {
      const result = validateProcedureFile({ size: 100, type });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('no permitido');
    }
  });

  it('rechaza archivos que superan 10 MB (mismo límite que documents)', () => {
    const result = validateProcedureFile({ size: 10 * 1024 * 1024 + 1, type: 'application/pdf' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('límite de 10 MB');
  });

  it('acepta exactamente 10 MB', () => {
    expect(validateProcedureFile({ size: 10 * 1024 * 1024, type: 'text/plain' })).toEqual({ ok: true });
  });

  it('el bucket es el privado dedicado, no reusa documents', () => {
    expect(PROCEDURES_BUCKET).toBe('procedimientos');
  });
});
