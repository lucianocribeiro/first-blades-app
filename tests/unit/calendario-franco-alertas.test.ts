/**
 * Tests unitarios — lógica de racha de las alertas de franco (FB-F3-09,
 * fix FB-F3-10 / FB-F3-AUD-09 Hallazgo 1)
 *
 * computeFrancoAlerts es una función pura: dado el set de empleados y sus
 * días reales de rotation_assignments dentro de la ventana, calcula la
 * racha vigente hoy para cada alerta (A: sin franco, B: franco excedido)
 * caminando por CADA FECHA DE CALENDARIO consecutiva hacia atrás desde hoy
 * (no sobre las filas existentes) — un día sin fila (hueco) corta la
 * racha igual que un 'resetea'; solo 'neutral' (en_viaje,
 * periodo_fuera_trabajo) se saltea sin cortar. Cubre: mapeo estado→efecto
 * de cada alerta, bordes de umbral, huecos (en hoy y entre bloques),
 * exclusión de estimados, y el borde de zona horaria de "hoy".
 */

import { describe, it, expect } from 'vitest';
import { getBusinessToday } from '@/lib/rotation/promote-estimated';
import {
  computeFrancoAlerts,
  FRANCO_ALERT_WINDOW_DAYS,
  getFrancoAlertWindowStart,
  type FrancoAlertaDia,
} from '@/app/(app)/calendario/francoAlerts';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';
import type { EstadoDia } from '@/lib/db-types';

const HOY = '2026-07-31';
const EMPLOYEES: RosterEmployee[] = [{ id: 'emp-1', full_name: 'Empleado Uno', email: 'emp1@test.com' }];

// `fecha` menos `n` días (fecha de calendario, sin componente horario).
function fechaMenos(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().split('T')[0];
}

// Genera `n` días consecutivos con `estado`, terminando en `fechaFin`
// (inclusive) — mismo formato que trae la query real. Sin huecos dentro
// del bloque; para encadenar bloques sin hueco entre ellos, usar
// fechaMenos para calcular el fechaFin del bloque siguiente.
function diasConsecutivos(
  fechaFin: string,
  n: number,
  estado: EstadoDia,
  overrides: Partial<FrancoAlertaDia> = {}
): FrancoAlertaDia[] {
  const dias: FrancoAlertaDia[] = [];
  for (let i = n - 1; i >= 0; i--) {
    dias.push({
      user_id: 'emp-1',
      fecha: fechaMenos(fechaFin, i),
      estado_dia: estado,
      es_estimado: false,
      ...overrides,
    });
  }
  return dias;
}

describe('computeFrancoAlerts — Alerta A (sin_franco: 48/60)', () => {
  it('47 días de trabajando consecutivos hasta hoy: NO alcanza el primer umbral, no aparece', () => {
    const dias = diasConsecutivos(HOY, 47, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows.filter((r) => r.tipo === 'sin_franco')).toHaveLength(0);
  });

  it('exactamente 48 días de trabajando hasta hoy: alcanza el primer umbral (nivel 1)', () => {
    const dias = diasConsecutivos(HOY, 48, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48);
    expect(row.umbral).toBe(48);
    expect(row.nivel).toBe(1);
  });

  it('exactamente 60 días de trabajando hasta hoy: alcanza el segundo umbral (nivel 2), no muestra el primero', () => {
    const dias = diasConsecutivos(HOY, 60, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const sinFranco = rows.filter((r) => r.tipo === 'sin_franco');
    expect(sinFranco).toHaveLength(1);
    expect(sinFranco[0].valor).toBe(60);
    expect(sinFranco[0].umbral).toBe(60);
    expect(sinFranco[0].nivel).toBe(2);
  });

  it('un en_franco en medio de una secuencia contigua resetea el conteo (no arrastra los días previos al reset)', () => {
    // Fechas 100% contiguas desde HOY hacia atrás: 48 trabajando (hasta
    // hoy), 1 en_franco justo antes, y 50 trabajando más antes de eso.
    // Sin el reset, sumaría 48+50=98 (segundo umbral); con el reset,
    // se frena en 48 apenas toca el en_franco.
    const recientes = diasConsecutivos(HOY, 48, 'trabajando');
    const franco = diasConsecutivos(fechaMenos(HOY, 48), 1, 'en_franco');
    const viejos = diasConsecutivos(fechaMenos(HOY, 49), 50, 'trabajando');

    const rows = computeFrancoAlerts(EMPLOYEES, [...recientes, ...franco, ...viejos], HOY);
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48);
    expect(row.umbral).toBe(48); // si arrastrara los 50 viejos, sería 98 → umbral 60
  });

  it('en_viaje y periodo_fuera_trabajo son neutrales: no suman ni resetean, en una secuencia 100% contigua', () => {
    // Contiguo desde HOY hacia atrás: 8 trabajando, 1 periodo_fuera_trabajo
    // (neutral), 20 trabajando, 1 en_viaje (neutral), 20 trabajando = 48
    // "suma" + 2 neutrales, sin ningún hueco entre bloques.
    const bloque3 = diasConsecutivos(HOY, 8, 'trabajando');
    const ausencia = diasConsecutivos(fechaMenos(HOY, 8), 1, 'periodo_fuera_trabajo');
    const bloque2 = diasConsecutivos(fechaMenos(HOY, 9), 20, 'trabajando');
    const viaje = diasConsecutivos(fechaMenos(HOY, 29), 1, 'en_viaje');
    const bloque1 = diasConsecutivos(fechaMenos(HOY, 30), 20, 'trabajando');

    const rows = computeFrancoAlerts(
      EMPLOYEES,
      [...bloque3, ...ausencia, ...bloque2, ...viaje, ...bloque1],
      HOY
    );
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48); // 8 + 20 + 20, los 2 neutrales no suman ni cortan
  });
});

describe('computeFrancoAlerts — Alerta B (franco_excedido: 10/12), espejo de A', () => {
  it('9 días de en_franco consecutivos hasta hoy: NO alcanza el primer umbral', () => {
    const dias = diasConsecutivos(HOY, 9, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows.filter((r) => r.tipo === 'franco_excedido')).toHaveLength(0);
  });

  it('exactamente 10 días de en_franco hasta hoy: alcanza el primer umbral (nivel 1)', () => {
    const dias = diasConsecutivos(HOY, 10, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(10);
    expect(row.umbral).toBe(10);
    expect(row.nivel).toBe(1);
  });

  it('exactamente 12 días de en_franco hasta hoy: alcanza el segundo umbral (nivel 2)', () => {
    const dias = diasConsecutivos(HOY, 12, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(12);
    expect(row.umbral).toBe(12);
    expect(row.nivel).toBe(2);
  });

  it('un trabajando en medio de una secuencia contigua corta la racha de franco', () => {
    const recientes = diasConsecutivos(HOY, 5, 'en_franco');
    const corte = diasConsecutivos(fechaMenos(HOY, 5), 1, 'trabajando');
    const viejos = diasConsecutivos(fechaMenos(HOY, 6), 15, 'en_franco');

    const rows = computeFrancoAlerts(EMPLOYEES, [...recientes, ...corte, ...viejos], HOY);
    expect(rows.filter((r) => r.tipo === 'franco_excedido')).toHaveLength(0); // 5 < 10, no arrastra los 15 viejos
  });

  it('en_viaje y periodo_fuera_trabajo son neutrales para la racha de franco (secuencia contigua)', () => {
    const bloque2 = diasConsecutivos(HOY, 5, 'en_franco');
    const viaje = diasConsecutivos(fechaMenos(HOY, 5), 1, 'en_viaje');
    const bloque1 = diasConsecutivos(fechaMenos(HOY, 6), 5, 'en_franco');

    const rows = computeFrancoAlerts(EMPLOYEES, [...bloque2, ...viaje, ...bloque1], HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(10); // 5 + 5, el neutral no suma
  });
});

describe('computeFrancoAlerts — huecos cortan la racha (FB-F3-10 / FB-F3-AUD-09 Hallazgo 1)', () => {
  it('hueco en hoy: 48 días trabajando hasta AYER, sin fila para hoy → sin alerta (Alerta A)', () => {
    const dias = diasConsecutivos(fechaMenos(HOY, 1), 48, 'trabajando'); // termina ayer, nada para HOY
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows.filter((r) => r.tipo === 'sin_franco')).toHaveLength(0);
  });

  it('hueco en hoy: 12 días en_franco hasta AYER, sin fila para hoy → sin alerta (Alerta B)', () => {
    const dias = diasConsecutivos(fechaMenos(HOY, 1), 12, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows.filter((r) => r.tipo === 'franco_excedido')).toHaveLength(0);
  });

  it('hueco entre bloques corta la racha (Alerta A): no arrastra los días antes del hueco', () => {
    // 48 trabajando hasta hoy (contiguos), un hueco de 1 día (SIN fila),
    // y 50 trabajando más viejos aún. Sin el fix, el hueco se saltearía
    // como neutral y daría 98 (segundo umbral); con el fix, corta en 48.
    const recientes = diasConsecutivos(HOY, 48, 'trabajando'); // hasta HOY
    // fechaMenos(HOY, 48) queda deliberadamente SIN fila (el hueco).
    const viejos = diasConsecutivos(fechaMenos(HOY, 49), 50, 'trabajando');

    const rows = computeFrancoAlerts(EMPLOYEES, [...recientes, ...viejos], HOY);
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48);
    expect(row.umbral).toBe(48); // no 60 — el hueco cortó antes de sumar los 50 viejos
  });

  it('hueco entre bloques corta la racha (Alerta B): no arrastra los días antes del hueco', () => {
    const recientes = diasConsecutivos(HOY, 10, 'en_franco'); // hasta HOY
    // fechaMenos(HOY, 10) queda SIN fila (el hueco).
    const viejos = diasConsecutivos(fechaMenos(HOY, 11), 20, 'en_franco');

    const rows = computeFrancoAlerts(EMPLOYEES, [...recientes, ...viejos], HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(10);
    expect(row.umbral).toBe(10); // no 12 — el hueco cortó antes de sumar los 20 viejos
  });
});

describe('computeFrancoAlerts — días estimados excluidos (equivalen a hueco)', () => {
  it('un día es_estimado = true en medio de una secuencia contigua CORTA la racha (no se saltea como neutral)', () => {
    const reciente = diasConsecutivos(HOY, 24, 'trabajando');
    const estimado = diasConsecutivos(fechaMenos(HOY, 24), 1, 'trabajando', { es_estimado: true });
    const viejo = diasConsecutivos(fechaMenos(HOY, 25), 24, 'trabajando');

    const rows = computeFrancoAlerts(EMPLOYEES, [...reciente, ...estimado, ...viejo], HOY);
    // 24 < 48: el estimado corta antes de sumar los 24 días viejos (si se
    // salteara como neutral, sumaría 48 y SÍ aparecería la alerta).
    expect(rows.filter((r) => r.tipo === 'sin_franco')).toHaveLength(0);
  });

  it('un empleado que solo tiene días estimados no genera alerta', () => {
    const dias = diasConsecutivos(HOY, 60, 'trabajando', { es_estimado: true });
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows).toHaveLength(0);
  });
});

describe('computeFrancoAlerts — borde de zona horaria en "hoy" (reforzado, no vacuo)', () => {
  it('distingue el "hoy" de negocio (AR) del "mañana" (mismo instante en UTC): el día futuro NO cuenta con el hoy correcto, pero SÍ cruzaría el umbral si se usara mal', () => {
    // Instante de referencia: 2026-07-15T01:00:00Z → hoy en Argentina es
    // '2026-07-14' (mismo borde que getBusinessToday, ver
    // tests/unit/promote-estimated.test.ts).
    const hoyNegocio = getBusinessToday(new Date('2026-07-15T01:00:00Z'));
    expect(hoyNegocio).toBe('2026-07-14');

    // 47 días reales contiguos hasta el hoy de negocio + 1 día real "de
    // mañana" (2026-07-15, que en UTC crudo coincide con la fecha del
    // instante de referencia).
    const dias47 = diasConsecutivos(hoyNegocio, 47, 'trabajando');
    const diaFuturo: FrancoAlertaDia = {
      user_id: 'emp-1',
      fecha: '2026-07-15',
      estado_dia: 'trabajando',
      es_estimado: false,
    };
    const todos = [...dias47, diaFuturo];

    // Con el "hoy" correcto (AR): el día futuro no participa (el walker
    // nunca camina hacia adelante), la racha queda en 47 — no alcanza el
    // umbral de 48.
    const rowsCorrecto = computeFrancoAlerts(EMPLOYEES, todos, hoyNegocio);
    expect(rowsCorrecto.filter((r) => r.tipo === 'sin_franco')).toHaveLength(0);

    // Si (mal) se usara el "hoy" crudo UTC del instante ('2026-07-15') en
    // vez de la fecha de negocio, el día futuro pasaría a ser "hoy" y la
    // racha SÍ llegaría a 48 (falso positivo) — confirma que el fixture
    // puede producir el falso positivo, y que con la fecha de negocio
    // correcta no ocurre.
    const rowsSiFueraUtc = computeFrancoAlerts(EMPLOYEES, todos, '2026-07-15');
    const rowSiFueraUtc = rowsSiFueraUtc.find((r) => r.tipo === 'sin_franco');
    expect(rowSiFueraUtc?.valor).toBe(48);
  });

  it('sin argumento, usa getBusinessToday() como default (misma zona que el resto del calendario)', () => {
    const rows = computeFrancoAlerts(EMPLOYEES, []);
    expect(rows).toEqual([]); // solo confirma que no explota sin argumento
  });
});

describe('getFrancoAlertWindowStart', () => {
  it(`FRANCO_ALERT_WINDOW_DAYS cubre el umbral más alto (60) con margen`, () => {
    expect(FRANCO_ALERT_WINDOW_DAYS).toBeGreaterThanOrEqual(60);
  });

  it('resta exactamente la ventana de días', () => {
    expect(getFrancoAlertWindowStart('2026-07-31', 65)).toBe('2026-05-27');
  });

  it('cruza el fin de año correctamente', () => {
    expect(getFrancoAlertWindowStart('2026-01-10', 65)).toBe('2025-11-06');
  });
});
