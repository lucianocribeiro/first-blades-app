/**
 * Tests unitarios — Validación de edición de celda del roster (FB-F3-04)
 *
 * Refina en la UI la misma regla que el CHECK de base
 * rotation_assignments_motivo_requerido (migración 0009): periodo_fuera_trabajo
 * exige motivo_ausencia, y motivo_ausencia='otros' exige motivo_otros_texto
 * (máx. 80 caracteres, mismo límite que la columna VARCHAR(80)).
 */

import { describe, it, expect } from 'vitest';
import { copy } from '@/lib/copy';
import { validateAssignmentInput } from '@/app/(app)/calendario/utils';

describe('validateAssignmentInput', () => {
  it('trabajando es válido sin motivo', () => {
    expect(validateAssignmentInput({ estado_dia: 'trabajando' })).toEqual({ valid: true });
  });

  it('en_viaje es válido sin motivo', () => {
    expect(validateAssignmentInput({ estado_dia: 'en_viaje' })).toEqual({ valid: true });
  });

  it('en_franco es válido sin motivo', () => {
    expect(validateAssignmentInput({ estado_dia: 'en_franco' })).toEqual({ valid: true });
  });

  it('periodo_fuera_trabajo SIN motivo_ausencia bloquea el guardado', () => {
    const result = validateAssignmentInput({ estado_dia: 'periodo_fuera_trabajo' });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe(copy.calendario.errors.motivoRequerido);
  });

  it('periodo_fuera_trabajo con motivo_ausencia distinto de "otros" es válido', () => {
    expect(
      validateAssignmentInput({ estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'vacaciones' })
    ).toEqual({ valid: true });
  });

  it('periodo_fuera_trabajo con motivo "otros" SIN texto bloquea el guardado', () => {
    const result = validateAssignmentInput({
      estado_dia: 'periodo_fuera_trabajo',
      motivo_ausencia: 'otros',
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe(copy.calendario.errors.motivoOtrosRequerido);
  });

  it('periodo_fuera_trabajo con motivo "otros" y texto vacío/espacios bloquea el guardado', () => {
    const result = validateAssignmentInput({
      estado_dia: 'periodo_fuera_trabajo',
      motivo_ausencia: 'otros',
      motivo_otros_texto: '   ',
    });
    expect(result.valid).toBe(false);
  });

  it('periodo_fuera_trabajo con motivo "otros" y texto > 80 caracteres bloquea el guardado', () => {
    const result = validateAssignmentInput({
      estado_dia: 'periodo_fuera_trabajo',
      motivo_ausencia: 'otros',
      motivo_otros_texto: 'x'.repeat(81),
    });
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toBe(copy.calendario.errors.motivoOtrosMaximo);
  });

  it('periodo_fuera_trabajo con motivo "otros" y texto válido (≤80) pasa', () => {
    expect(
      validateAssignmentInput({
        estado_dia: 'periodo_fuera_trabajo',
        motivo_ausencia: 'otros',
        motivo_otros_texto: 'x'.repeat(80),
      })
    ).toEqual({ valid: true });
  });
});
