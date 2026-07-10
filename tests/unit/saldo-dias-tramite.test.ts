/**
 * FB-F3-21 — Saldo derivado de días de trámite (consumidos/restantes).
 *
 * Cubre computeSaldoDiasTramite y getYearRange, ambas funciones puras
 * (sin Supabase, sin I/O):
 *  - es_estimado SÍ cuenta (regla opuesta a la racha de franco), y se
 *    propaga como metadata de display (esEstimado) en `fechas`.
 *  - borde de año: un día del año anterior no cuenta contra el año en curso.
 *  - restantes = tope - consumidos; excedido cuando consumidos > tope.
 *  - recalcula: es pura, así que el mismo input siempre da el mismo output,
 *    y un input distinto (celda borrada/motivo cambiado) da un resultado
 *    distinto — no hay estado ni caché que quede stale.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSaldoDiasTramite,
  getYearRange,
  TOPE_DIAS_TRAMITE_ANUAL,
  type SaldoDiasTramiteEmployee,
  type DiaTramiteRow,
} from '@/lib/rotation/saldo-dias-tramite';

const EMP: SaldoDiasTramiteEmployee = { id: 'emp-1', full_name: 'Empleado Uno', email: 'emp1@test.com' };

// Fixture: fecha + es_estimado explícito (default false, el caso "confirmado").
function dia(userId: string, fecha: string, esEstimado = false): DiaTramiteRow {
  return { user_id: userId, fecha, es_estimado: esEstimado };
}

describe('getYearRange', () => {
  it('devuelve el 1/1 al 31/12 del año de `today`', () => {
    expect(getYearRange('2027-06-15')).toEqual({ start: '2027-01-01', end: '2027-12-31' });
  });

  it('funciona en los bordes del año (1/1 y 31/12)', () => {
    expect(getYearRange('2027-01-01')).toEqual({ start: '2027-01-01', end: '2027-12-31' });
    expect(getYearRange('2027-12-31')).toEqual({ start: '2027-01-01', end: '2027-12-31' });
  });
});

describe('computeSaldoDiasTramite: consumo básico', () => {
  it('sin días: 0 consumidos, restantes = tope, no excedido', () => {
    const [row] = computeSaldoDiasTramite([EMP], []);
    expect(row).toMatchObject({ employeeId: 'emp-1', consumidos: 0, restantes: TOPE_DIAS_TRAMITE_ANUAL, excedido: false, fechas: [] });
  });

  it('cuenta cada fila de rotation_assignments del empleado, ordena las fechas', () => {
    const dias = [dia('emp-1', '2027-03-10'), dia('emp-1', '2027-01-05')];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.consumidos).toBe(2);
    expect(row.fechas.map((f) => f.fecha)).toEqual(['2027-01-05', '2027-03-10']);
  });

  it('no mezcla el consumo de un empleado con el de otro', () => {
    const otro: SaldoDiasTramiteEmployee = { id: 'emp-2', full_name: 'Otro', email: 'emp2@test.com' };
    const dias = [dia('emp-2', '2027-01-05')];
    const [rowEmp1, rowEmp2] = computeSaldoDiasTramite([EMP, otro], dias);
    expect(rowEmp1.consumidos).toBe(0);
    expect(rowEmp2.consumidos).toBe(1);
  });
});

describe('computeSaldoDiasTramite: es_estimado cuenta (regla opuesta a la de franco)', () => {
  it('un día de trámite planificado a futuro (es_estimado=true) suma al consumo igual que uno confirmado', () => {
    const dias = [dia('emp-1', '2027-05-01', true), dia('emp-1', '2027-05-02', false)];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.consumidos).toBe(2);
  });

  it('propaga es_estimado como metadata de display en `fechas` (esEstimado), sin afectar el conteo', () => {
    const dias = [dia('emp-1', '2027-05-01', true), dia('emp-1', '2027-05-02', false)];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.fechas).toEqual([
      { fecha: '2027-05-01', esEstimado: true },
      { fecha: '2027-05-02', esEstimado: false },
    ]);
  });
});

describe('computeSaldoDiasTramite: borde de año', () => {
  it('un día de trámite de un año distinto no debe pasarse a este helper (responsabilidad del caller filtrar por getYearRange)', () => {
    // El helper no filtra por año — confía en que el caller ya acotó `dias`
    // con getYearRange() en la query. Este test documenta esa frontera: si
    // el caller pasara filas de dos años, el helper las cuenta todas.
    const dias = [dia('emp-1', '2026-12-31'), dia('emp-1', '2027-01-01')];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.consumidos).toBe(2); // el helper no filtra — el caller sí, vía getYearRange
  });

  it('el caller filtra correctamente: solo pasar los del año en curso deja fuera el del año anterior', () => {
    const { start, end } = getYearRange('2027-06-01');
    const todasLasFilas = [dia('emp-1', '2026-12-31'), dia('emp-1', '2027-01-01')];
    const soloEsteAño = todasLasFilas.filter((d) => d.fecha >= start && d.fecha <= end);
    const [row] = computeSaldoDiasTramite([EMP], soloEsteAño);
    expect(row.consumidos).toBe(1);
    expect(row.fechas).toEqual([{ fecha: '2027-01-01', esEstimado: false }]);
  });
});

describe('computeSaldoDiasTramite: restantes y exceso', () => {
  it('restantes = tope - consumidos', () => {
    const dias = [dia('emp-1', '2027-01-01'), dia('emp-1', '2027-02-01')];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.restantes).toBe(1);
    expect(row.excedido).toBe(false);
  });

  it('exactamente en el tope (3/3): restantes=0, no excedido', () => {
    const dias = [dia('emp-1', '2027-01-01'), dia('emp-1', '2027-02-01'), dia('emp-1', '2027-03-01')];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.restantes).toBe(0);
    expect(row.excedido).toBe(false);
  });

  it('consumidos > tope: restantes negativo, excedido = true', () => {
    const dias = [
      dia('emp-1', '2027-01-01'),
      dia('emp-1', '2027-02-01'),
      dia('emp-1', '2027-03-01'),
      dia('emp-1', '2027-04-01'),
    ];
    const [row] = computeSaldoDiasTramite([EMP], dias);
    expect(row.consumidos).toBe(4);
    expect(row.restantes).toBe(-1);
    expect(row.excedido).toBe(true);
  });

  it('tope personalizado (parámetro): respeta el tope pasado en vez del default', () => {
    const dias = [dia('emp-1', '2027-01-01')];
    const [row] = computeSaldoDiasTramite([EMP], dias, 1);
    expect(row.restantes).toBe(0);
    expect(row.excedido).toBe(false);
  });
});

describe('computeSaldoDiasTramite: recalcula (pura, sin estado stale)', () => {
  it('el mismo input siempre da el mismo output', () => {
    const dias = [dia('emp-1', '2027-01-01')];
    const first = computeSaldoDiasTramite([EMP], dias);
    const second = computeSaldoDiasTramite([EMP], dias);
    expect(first).toEqual(second);
  });

  it('borrar/cambiar el motivo de una celda (simulado como una fila menos) cambia el resultado', () => {
    const antes = [dia('emp-1', '2027-01-01'), dia('emp-1', '2027-02-01')];
    const despuesDeBorrarUna = [dia('emp-1', '2027-01-01')];

    const rowAntes = computeSaldoDiasTramite([EMP], antes)[0];
    const rowDespues = computeSaldoDiasTramite([EMP], despuesDeBorrarUna)[0];

    expect(rowAntes.consumidos).toBe(2);
    expect(rowDespues.consumidos).toBe(1);
  });
});
