/**
 * FB-F3-07 — Funciones puras del cron de promoción estimado → real:
 * cálculo de "hoy" en zona horaria de Argentina y la ventana de 7 días.
 */
import { describe, it, expect } from 'vitest';
import {
  getBusinessToday,
  getPromotionCutoff,
  PROMOTION_WINDOW_DAYS,
} from '@/lib/rotation/promote-estimated';

describe('getBusinessToday: fecha local en America/Argentina/Buenos_Aires (UTC-3, sin DST)', () => {
  it('a la 01:00 UTC todavía es el día anterior en Argentina (borde de zona horaria)', () => {
    // 2026-07-15T01:00:00Z - 3h = 2026-07-14T22:00:00 hora Argentina.
    expect(getBusinessToday(new Date('2026-07-15T01:00:00Z'))).toBe('2026-07-14');
  });

  it('a las 13:00 UTC ya es el mismo día en Argentina (contraejemplo del borde anterior)', () => {
    // 2026-07-15T13:00:00Z - 3h = 2026-07-15T10:00:00 hora Argentina.
    expect(getBusinessToday(new Date('2026-07-15T13:00:00Z'))).toBe('2026-07-15');
  });

  it('justo en el límite de las 03:00 UTC ya cruzó a Argentina (00:00 AR)', () => {
    expect(getBusinessToday(new Date('2026-07-15T03:00:00Z'))).toBe('2026-07-15');
  });

  it('sin argumento devuelve una fecha con formato YYYY-MM-DD', () => {
    expect(getBusinessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getPromotionCutoff: ventana de 7 días', () => {
  it(`PROMOTION_WINDOW_DAYS es ${7}`, () => {
    expect(PROMOTION_WINDOW_DAYS).toBe(7);
  });

  it('suma exactamente 7 días', () => {
    expect(getPromotionCutoff('2026-07-01')).toBe('2026-07-08');
  });

  it('cruza el fin de mes correctamente', () => {
    expect(getPromotionCutoff('2026-07-28')).toBe('2026-08-04');
  });

  it('cruza el fin de año correctamente', () => {
    expect(getPromotionCutoff('2026-12-28')).toBe('2027-01-04');
  });

  it('sin argumento usa getBusinessToday() como base', () => {
    expect(getPromotionCutoff()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
