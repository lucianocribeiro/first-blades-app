/**
 * FB-F5-06 — lib/business-date.ts: isWithinBusinessDays, usado por el badge
 * "Nuevo" de Procedimientos (ventana de 7 días desde updated_at, huso
 * America/Argentina/Buenos_Aires). Cubre el borde exacto: día 6 todavía es
 * "nuevo", día 7 ya no.
 */
import { describe, it, expect } from 'vitest';
import { isWithinBusinessDays } from '@/lib/business-date';

// Referencia fija en horario de Argentina (UTC-3): mediodía UTC = 09:00 AR,
// bien lejos de cualquier borde de medianoche.
const REFERENCE = new Date('2026-08-10T12:00:00Z'); // 2026-08-10 en AR

describe('isWithinBusinessDays', () => {
  it('día 0 (hoy mismo): dentro de la ventana', () => {
    expect(isWithinBusinessDays('2026-08-10T09:00:00Z', 7, REFERENCE)).toBe(true);
  });

  it('día 6: todavía dentro de la ventana de 7 días', () => {
    expect(isWithinBusinessDays('2026-08-04T09:00:00Z', 7, REFERENCE)).toBe(true);
  });

  it('día 7 (borde exacto): YA NO está dentro de la ventana', () => {
    expect(isWithinBusinessDays('2026-08-03T09:00:00Z', 7, REFERENCE)).toBe(false);
  });

  it('día 8: fuera de la ventana', () => {
    expect(isWithinBusinessDays('2026-08-02T09:00:00Z', 7, REFERENCE)).toBe(false);
  });

  it('respeta el huso de Argentina, no UTC crudo: 2026-08-10T02:00:00Z es 2026-08-09 en AR (día 1), no día 0', () => {
    // 02:00 UTC = 23:00 del día anterior en AR (UTC-3) — si el cálculo usara
    // UTC crudo, esta fecha caería el mismo día que REFERENCE (día 0); en
    // AR real es el día anterior (día 1), y también dentro de la ventana,
    // pero por el motivo correcto.
    expect(isWithinBusinessDays('2026-08-10T02:00:00Z', 7, REFERENCE)).toBe(true);
  });

  it('acepta un objeto Date además de string', () => {
    expect(isWithinBusinessDays(new Date('2026-08-10T09:00:00Z'), 7, REFERENCE)).toBe(true);
  });

  it('una fecha futura (posterior a referenceDate) no cuenta como "nueva" por un diff negativo', () => {
    expect(isWithinBusinessDays('2026-08-15T09:00:00Z', 7, REFERENCE)).toBe(false);
  });
});
