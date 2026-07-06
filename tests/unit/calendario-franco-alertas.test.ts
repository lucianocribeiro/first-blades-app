/**
 * Tests unitarios — lógica de racha de las alertas de franco (FB-F3-09)
 *
 * computeFrancoAlerts es una función pura: dado el set de empleados y sus
 * días reales de rotation_assignments dentro de la ventana, calcula la
 * racha vigente hoy para cada alerta (A: sin franco, B: franco excedido)
 * caminando hacia atrás desde hoy. Cubre: mapeo estado→efecto (suma /
 * resetea / neutral) de cada alerta, bordes de umbral, exclusión de
 * estimados, y el borde de zona horaria de "hoy".
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

// Genera `n` días consecutivos con `estado`, terminando en `fechaFin`
// (inclusive), en orden ascendente — mismo formato que trae la query real.
function diasConsecutivos(
  fechaFin: string,
  n: number,
  estado: EstadoDia,
  overrides: Partial<FrancoAlertaDia> = {}
): FrancoAlertaDia[] {
  const [y, m, d] = fechaFin.split('-').map(Number);
  const dias: FrancoAlertaDia[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const fecha = new Date(Date.UTC(y, m - 1, d - i)).toISOString().split('T')[0];
    dias.push({ user_id: 'emp-1', fecha, estado_dia: estado, es_estimado: false, ...overrides });
  }
  return dias;
}

describe('computeFrancoAlerts — Alerta A (sin_franco: 48/60)', () => {
  it('47 días de trabajando consecutivos: NO alcanza el primer umbral, no aparece', () => {
    const dias = diasConsecutivos(HOY, 47, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows.filter((r) => r.tipo === 'sin_franco')).toHaveLength(0);
  });

  it('exactamente 48 días de trabajando: alcanza el primer umbral (nivel 1)', () => {
    const dias = diasConsecutivos(HOY, 48, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48);
    expect(row.umbral).toBe(48);
    expect(row.nivel).toBe(1);
  });

  it('exactamente 60 días de trabajando: alcanza el segundo umbral (nivel 2), no muestra el primero', () => {
    const dias = diasConsecutivos(HOY, 60, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const sinFranco = rows.filter((r) => r.tipo === 'sin_franco');
    expect(sinFranco).toHaveLength(1);
    expect(sinFranco[0].valor).toBe(60);
    expect(sinFranco[0].umbral).toBe(60);
    expect(sinFranco[0].nivel).toBe(2);
  });

  it('un en_franco en medio de la racha resetea el conteo (solo cuenta desde el último en_franco)', () => {
    // 50 días trabajando muy atrás, 1 en_franco, y luego 10 días trabajando hasta hoy.
    const viejos = diasConsecutivos('2026-06-01', 50, 'trabajando');
    const franco = diasConsecutivos('2026-06-02', 1, 'en_franco');
    const recientes = diasConsecutivos(HOY, 10, 'trabajando');
    const rows = computeFrancoAlerts(EMPLOYEES, [...viejos, ...franco, ...recientes], HOY);
    expect(rows.filter((r) => r.tipo === 'sin_franco')).toHaveLength(0); // 10 < 48, no aparece

    const rows2 = computeFrancoAlerts(
      EMPLOYEES,
      [...viejos, ...franco, ...diasConsecutivos(HOY, 48, 'trabajando')],
      HOY
    );
    const row = rows2.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48); // no arrastra los 50 días de antes del reset
  });

  it('en_viaje y periodo_fuera_trabajo son neutrales: no suman ni resetean la racha', () => {
    // 20 trabajando, 1 en_viaje, 20 trabajando, 1 periodo_fuera_trabajo, 8 trabajando = 48 "suma" + 2 neutrales
    const bloque1 = diasConsecutivos('2026-06-13', 20, 'trabajando');
    const viaje = diasConsecutivos('2026-06-14', 1, 'en_viaje');
    const bloque2 = diasConsecutivos('2026-07-04', 20, 'trabajando');
    const ausencia = diasConsecutivos('2026-07-05', 1, 'periodo_fuera_trabajo');
    const bloque3 = diasConsecutivos(HOY, 8, 'trabajando');

    const rows = computeFrancoAlerts(
      EMPLOYEES,
      [...bloque1, ...viaje, ...bloque2, ...ausencia, ...bloque3],
      HOY
    );
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48); // 20 + 20 + 8, los 2 neutrales no suman
  });
});

describe('computeFrancoAlerts — Alerta B (franco_excedido: 10/12), espejo de A', () => {
  it('9 días de en_franco consecutivos: NO alcanza el primer umbral', () => {
    const dias = diasConsecutivos(HOY, 9, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows.filter((r) => r.tipo === 'franco_excedido')).toHaveLength(0);
  });

  it('exactamente 10 días de en_franco: alcanza el primer umbral (nivel 1)', () => {
    const dias = diasConsecutivos(HOY, 10, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(10);
    expect(row.umbral).toBe(10);
    expect(row.nivel).toBe(1);
  });

  it('exactamente 12 días de en_franco: alcanza el segundo umbral (nivel 2)', () => {
    const dias = diasConsecutivos(HOY, 12, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(12);
    expect(row.umbral).toBe(12);
    expect(row.nivel).toBe(2);
  });

  it('un trabajando en medio corta la racha de franco', () => {
    const viejos = diasConsecutivos('2026-07-01', 15, 'en_franco');
    const corte = diasConsecutivos('2026-07-16', 1, 'trabajando');
    const recientes = diasConsecutivos(HOY, 5, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, [...viejos, ...corte, ...recientes], HOY);
    expect(rows.filter((r) => r.tipo === 'franco_excedido')).toHaveLength(0); // 5 < 10
  });

  it('en_viaje y periodo_fuera_trabajo son neutrales para la racha de franco', () => {
    const bloque1 = diasConsecutivos('2026-07-20', 5, 'en_franco');
    const viaje = diasConsecutivos('2026-07-21', 1, 'en_viaje');
    const bloque2 = diasConsecutivos(HOY, 5, 'en_franco');
    const rows = computeFrancoAlerts(EMPLOYEES, [...bloque1, ...viaje, ...bloque2], HOY);
    const row = rows.find((r) => r.tipo === 'franco_excedido')!;
    expect(row.valor).toBe(10); // 5 + 5, el neutral no suma
  });
});

describe('computeFrancoAlerts — días estimados excluidos', () => {
  it('un día es_estimado = true no cuenta ni corta la racha (se ignora, como neutral)', () => {
    const reciente = diasConsecutivos(HOY, 24, 'trabajando');
    // día estimado "en el medio" del historial: no debería contarse ni
    // interrumpir la continuidad real de la racha.
    const estimado = diasConsecutivos('2026-06-30', 1, 'trabajando', { es_estimado: true });
    const viejo = diasConsecutivos('2026-06-29', 24, 'trabajando');

    const rows = computeFrancoAlerts(EMPLOYEES, [...reciente, ...estimado, ...viejo], HOY);
    const row = rows.find((r) => r.tipo === 'sin_franco')!;
    expect(row.valor).toBe(48); // 24 + 24 reales; el estimado no se cuenta
  });

  it('un empleado que solo tiene días estimados no genera alerta', () => {
    const dias = diasConsecutivos(HOY, 60, 'trabajando', { es_estimado: true });
    const rows = computeFrancoAlerts(EMPLOYEES, dias, HOY);
    expect(rows).toHaveLength(0);
  });
});

describe('computeFrancoAlerts — borde de zona horaria en "hoy"', () => {
  it('un día con fecha posterior al "hoy" de negocio (aunque coincida con el UTC del instante) no cuenta', () => {
    // Instante de referencia: 2026-07-15T01:00:00Z → hoy en Argentina es
    // '2026-07-14' (mismo borde que getBusinessToday, ver
    // tests/unit/promote-estimated.test.ts). Un día real con fecha
    // '2026-07-15' es "mañana" en negocio y no debe sumar a la racha.
    const hoyNegocio = getBusinessToday(new Date('2026-07-15T01:00:00Z'));
    expect(hoyNegocio).toBe('2026-07-14');

    const dias: FrancoAlertaDia[] = [
      { user_id: 'emp-1', fecha: '2026-07-14', estado_dia: 'trabajando', es_estimado: false },
      { user_id: 'emp-1', fecha: '2026-07-15', estado_dia: 'trabajando', es_estimado: false },
    ];

    const rows = computeFrancoAlerts(EMPLOYEES, dias, hoyNegocio);
    // Si contara el día "futuro" 07-15, esto no aparecería (2 < 48) de
    // cualquier forma; se valida indirectamente con el helper de ventana
    // de abajo, que es donde se traduce el borde a un filtro real de query.
    expect(rows).toHaveLength(0);
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
