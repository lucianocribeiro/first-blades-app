import { describe, it, expect } from 'vitest';
import { isEligibleForPurge, getPurgeCutoff, RETENTION_DAYS } from '@/lib/purge';
import { copy } from '@/lib/copy';

// ─── isEligibleForPurge ───────────────────────────────────────

describe('isEligibleForPurge', () => {
  const cutoff = new Date('2026-05-20T00:00:00Z'); // referencia fija

  const baseDoc = {
    estado: 'rechazado',
    reviewed_at: '2026-05-01T12:00:00Z', // 19 días antes del cutoff = > RETENTION_DAYS si cutoff es 20 mayo
    file_purged_at: null,
  };

  it('devuelve true para documento rechazado elegible', () => {
    expect(isEligibleForPurge(baseDoc, cutoff)).toBe(true);
  });

  it('devuelve false si estado no es rechazado', () => {
    expect(isEligibleForPurge({ ...baseDoc, estado: 'pendiente' }, cutoff)).toBe(false);
    expect(isEligibleForPurge({ ...baseDoc, estado: 'aprobado' }, cutoff)).toBe(false);
  });

  it('devuelve false si file_purged_at ya está seteado (idempotencia)', () => {
    expect(isEligibleForPurge({ ...baseDoc, file_purged_at: '2026-05-19T00:00:00Z' }, cutoff)).toBe(false);
  });

  it('devuelve false si reviewed_at es null', () => {
    expect(isEligibleForPurge({ ...baseDoc, reviewed_at: null }, cutoff)).toBe(false);
  });

  it('devuelve false si reviewed_at es igual al cutoff (mismo instante, no strictamente menor)', () => {
    expect(isEligibleForPurge({ ...baseDoc, reviewed_at: cutoff.toISOString() }, cutoff)).toBe(false);
  });

  it('devuelve false si reviewed_at es posterior al cutoff (no vencido)', () => {
    const recent = new Date(cutoff.getTime() + 1000).toISOString();
    expect(isEligibleForPurge({ ...baseDoc, reviewed_at: recent }, cutoff)).toBe(false);
  });

  it('devuelve true para reviewed_at exactamente un milisegundo antes del cutoff', () => {
    const justBefore = new Date(cutoff.getTime() - 1).toISOString();
    expect(isEligibleForPurge({ ...baseDoc, reviewed_at: justBefore }, cutoff)).toBe(true);
  });
});

// ─── getPurgeCutoff ───────────────────────────────────────────

describe('getPurgeCutoff', () => {
  it(`resta exactamente ${RETENTION_DAYS} días a la fecha de referencia`, () => {
    const ref = new Date('2026-06-19T12:00:00Z');
    const cutoff = getPurgeCutoff(ref);

    const expected = new Date('2026-05-20T12:00:00Z');
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('usa la fecha actual cuando no se pasa referencia', () => {
    const before = Date.now();
    const cutoff = getPurgeCutoff();
    const after = Date.now();

    const expectedMin = before - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expectedMax = after  - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('no muta la fecha de referencia', () => {
    const ref = new Date('2026-06-19T00:00:00Z');
    const refTime = ref.getTime();
    getPurgeCutoff(ref);
    expect(ref.getTime()).toBe(refTime);
  });
});

// ─── RETENTION_DAYS ───────────────────────────────────────────

describe('RETENTION_DAYS', () => {
  it('es 30', () => {
    expect(RETENTION_DAYS).toBe(30);
  });
});

// ─── Copy es-AR ───────────────────────────────────────────────

describe('copy.documentos.archivoEliminado', () => {
  it('contiene el texto de archivo eliminado en español', () => {
    expect(copy.documentos.archivoEliminado).toBeTruthy();
    expect(copy.documentos.archivoEliminado).toContain('30 días');
  });
});
