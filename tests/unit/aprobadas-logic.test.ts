/**
 * FB-F4-14 — funciones puras de app/(app)/aprobadas/logic.ts:
 *  - validateFechasEdicionAusencia / validateDiasEdicionPasaje: no-retroactiva
 *    de las fechas NUEVAS al editar (capa de app, mismo criterio que
 *    solicitud-ausencia/logic.ts y solicitud-pasaje/logic.ts).
 *  - translateCancelarEditarError: traduce el bloqueo LIFO y la condición de
 *    carrera de las RPCs cancelar_editar_* (0017) a copy amigable; cualquier
 *    otro error devuelve null (la action no debe tragarlo).
 */
import { describe, it, expect } from 'vitest';
import {
  validateFechasEdicionAusencia,
  validateDiasEdicionPasaje,
  translateCancelarEditarError,
} from '@/app/(app)/aprobadas/logic';
import { copy } from '@/lib/copy';

const TODAY = '2027-01-01';

describe('validateFechasEdicionAusencia', () => {
  it('rechaza si falta alguna fecha', () => {
    expect(validateFechasEdicionAusencia('', '2027-06-01', TODAY)).toEqual({
      valid: false,
      error: copy.aprobadas.errors.fechaRequerida,
    });
    expect(validateFechasEdicionAusencia('2027-06-01', '', TODAY)).toEqual({
      valid: false,
      error: copy.aprobadas.errors.fechaRequerida,
    });
  });

  it('rechaza rango invertido (fecha_fin < fecha_inicio)', () => {
    expect(validateFechasEdicionAusencia('2027-06-05', '2027-06-01', TODAY)).toEqual({
      valid: false,
      error: copy.aprobadas.errors.fechaFinAnteriorAInicio,
    });
  });

  it('rechaza fecha de inicio retroactiva', () => {
    expect(validateFechasEdicionAusencia('2026-12-31', '2027-06-05', TODAY)).toEqual({
      valid: false,
      error: copy.aprobadas.errors.fechaRetroactiva,
    });
  });

  it('acepta hoy como fecha de inicio (no retroactivo)', () => {
    expect(validateFechasEdicionAusencia(TODAY, TODAY, TODAY)).toEqual({ valid: true });
  });

  it('acepta fecha_inicio === fecha_fin (un solo día)', () => {
    expect(validateFechasEdicionAusencia('2027-06-05', '2027-06-05', TODAY)).toEqual({ valid: true });
  });

  it('acepta un rango futuro válido', () => {
    expect(validateFechasEdicionAusencia('2027-06-01', '2027-06-05', TODAY)).toEqual({ valid: true });
  });
});

describe('validateDiasEdicionPasaje', () => {
  it('rechaza array vacío', () => {
    expect(validateDiasEdicionPasaje([], TODAY)).toEqual({
      valid: false,
      error: copy.aprobadas.errors.diasRequeridos,
    });
  });

  it('rechaza si CUALQUIER día es anterior a hoy, aunque el resto sea futuro', () => {
    expect(validateDiasEdicionPasaje(['2027-06-01', '2026-12-31', '2027-06-03'], TODAY)).toEqual({
      valid: false,
      error: copy.aprobadas.errors.diaRetroactivo,
    });
  });

  it('acepta hoy como día de viaje', () => {
    expect(validateDiasEdicionPasaje([TODAY], TODAY)).toEqual({ valid: true });
  });

  it('acepta días futuros discretos (no contiguos)', () => {
    expect(validateDiasEdicionPasaje(['2027-06-01', '2027-06-05'], TODAY)).toEqual({ valid: true });
  });
});

describe('translateCancelarEditarError', () => {
  it('devuelve null para error sin mensaje', () => {
    expect(translateCancelarEditarError(null)).toBeNull();
    expect(translateCancelarEditarError(undefined)).toBeNull();
    expect(translateCancelarEditarError({})).toBeNull();
  });

  it('bloqueo LIFO: extrae la lista de bloqueos y arma copy amigable', () => {
    const message =
      "No se puede cancelar la solicitud req-1: hay aprobaciones posteriores que se superponen y deben resolverse primero: pasaje abc-123 (2027-06-10, aprobada 2027-01-02 00:00:00+00); ausencia xyz-789 (2027-06-01 a 2027-06-03, aprobada 2027-01-01 00:00:00+00)";

    const result = translateCancelarEditarError({ message });

    expect(result).not.toBeNull();
    expect(result).toContain(copy.aprobadas.errors.lifoBloqueo);
    expect(result).toContain('pasaje abc-123 (2027-06-10, aprobada');
    expect(result).toContain('ausencia xyz-789 (2027-06-01 a 2027-06-03, aprobada');
    // No debe filtrar el prefijo crudo de Postgres ("No se puede cancelar la
    // solicitud req-1:") — el copy amigable reemplaza esa parte, no la envuelve.
    expect(result).not.toContain('No se puede cancelar la solicitud req-1');
  });

  it('condición de carrera: "no está aprobada" → yaNoVigente', () => {
    const result = translateCancelarEditarError({
      message: 'La solicitud req-1 no está aprobada (estado actual: pendiente)',
    });
    expect(result).toBe(copy.aprobadas.errors.yaNoVigente);
  });

  it('condición de carrera: "ya fue cancelada" → yaNoVigente', () => {
    const result = translateCancelarEditarError({ message: 'La solicitud req-1 ya fue cancelada' });
    expect(result).toBe(copy.aprobadas.errors.yaNoVigente);
  });

  it('condición de carrera: "no existe" → yaNoVigente', () => {
    const result = translateCancelarEditarError({ message: 'La solicitud req-1 no existe' });
    expect(result).toBe(copy.aprobadas.errors.yaNoVigente);
  });

  it('cualquier otro error (guardas defensivas de la RPC): devuelve null, no lo traga', () => {
    expect(
      translateCancelarEditarError({ message: 'Solo un administrador puede cancelar o editar una ausencia aprobada' })
    ).toBeNull();
    expect(
      translateCancelarEditarError({ message: 'El comentario es obligatorio para un cambio post-aprobación' })
    ).toBeNull();
    expect(
      translateCancelarEditarError({ message: 'El rango de fechas nuevo es inválido: 2027-06-01 es anterior a 2027-06-05' })
    ).toBeNull();
  });
});
