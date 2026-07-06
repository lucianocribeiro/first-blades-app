/**
 * Test de integración DB-backed — scope por rol del panel de alertas de
 * franco (FB-F3-09).
 *
 * Mismo patrón que tests/integration/calendario-dashboard-scope.test.ts:
 * replica bajo asUser() la MISMA query de `profiles` que arma page.tsx
 * (scope de app superpuesto a la RLS) más la nueva query de
 * `rotation_assignments` acotada a la ventana de ~65 días, y verifica que
 * computeFrancoAlerts sobre ese resultado coincide con el scope de la
 * grilla/dashboard para admin y supervisor. El bloqueo se prueba por query
 * real bajo RLS, no por UI — "empleado no ve el panel" es una decisión de
 * producto en page.tsx (unit, no DB), cubierta en
 * tests/unit/calendario-server-boundary.test.ts.
 *
 * Se usa una fecha "hoy" fija (no la real del sistema) para que el test
 * sea determinístico: se le pasa explícitamente a computeFrancoAlerts,
 * igual que page.tsx le pasaría getBusinessToday() en producción.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';
import { computeFrancoAlerts, getFrancoAlertWindowStart, type FrancoAlertaDia } from '@/app/(app)/calendario/francoAlerts';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

const HOY = '2026-07-31';
const WINDOW_START = getFrancoAlertWindowStart(HOY);

const ADMIN_EMPLOYEES_QUERY = `
  SELECT id, full_name, email FROM profiles
  WHERE status = 'activo' AND role IN ('empleado', 'supervisor')
  ORDER BY full_name
`;

const SUPERVISOR_EMPLOYEES_QUERY = `
  SELECT id, full_name, email FROM profiles
  WHERE status = 'activo' AND (id = $1 OR supervisor_id = $1)
  ORDER BY full_name
`;

type Row = { id: string; full_name: string | null; email: string };

async function loadFrancoDias(c: Client, employeeIds: string[]): Promise<FrancoAlertaDia[]> {
  const { rows } = await c.query(
    `SELECT user_id, fecha::text, estado_dia, es_estimado
     FROM rotation_assignments
     WHERE user_id = ANY($1::uuid[]) AND fecha >= $2 AND fecha <= $3`,
    [employeeIds, WINDOW_START, HOY]
  );
  return rows as FrancoAlertaDia[];
}

function fechaMenos(fechaFin: string, diasAtras: number): string {
  const [y, m, d] = fechaFin.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - diasAtras)).toISOString().split('T')[0];
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // employee1 (equipo de supervisor): 48 días trabajando consecutivos
  // hasta HOY → alcanza el primer umbral de sin_franco (48).
  const valuesEmployee1 = Array.from({ length: 48 }, (_, i) => {
    const fecha = fechaMenos(HOY, 47 - i);
    return `('${IDS.employee1}', '${fecha}', 'trabajando', false)`;
  }).join(',\n');

  // employee3 (equipo de supervisor2): 12 días en_franco consecutivos
  // hasta HOY → alcanza el segundo umbral de franco_excedido (12).
  const valuesEmployee3 = Array.from({ length: 12 }, (_, i) => {
    const fecha = fechaMenos(HOY, 11 - i);
    return `('${IDS.employee3}', '${fecha}', 'en_franco', false)`;
  }).join(',\n');

  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado) VALUES
      ${valuesEmployee1},
      ${valuesEmployee3}
    `
  );
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  if (!db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } catch (e) {
    console.warn('[afterAll] no se pudo liberar el advisory lock:', e);
  } finally {
    try {
      await db.end();
    } catch (e) {
      console.warn('[afterAll] no se pudo cerrar la conexión:', e);
    }
  }
});

describe.skipIf(!dbAvailable)('scope del panel de alertas de franco por rol (DB-backed)', () => {
  it('admin: ve las alertas de employee1 (sin_franco) y employee3 (franco_excedido)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: employeesRaw } = await c.query(ADMIN_EMPLOYEES_QUERY);
      const employees = employeesRaw as Row[];
      const dias = await loadFrancoDias(c, employees.map((e) => e.id));

      const alerts = computeFrancoAlerts(employees, dias, HOY);
      const byEmployee = new Map(alerts.map((a) => [`${a.employeeId}-${a.tipo}`, a]));

      expect(byEmployee.get(`${IDS.employee1}-sin_franco`)?.valor).toBe(48);
      expect(byEmployee.get(`${IDS.employee1}-sin_franco`)?.umbral).toBe(48);
      expect(byEmployee.get(`${IDS.employee3}-franco_excedido`)?.valor).toBe(12);
      expect(byEmployee.get(`${IDS.employee3}-franco_excedido`)?.umbral).toBe(12);
    });
  });

  it('supervisor: ve la alerta de employee1 (su equipo), NADA de employee3 (equipo ajeno)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows: employeesRaw } = await c.query(SUPERVISOR_EMPLOYEES_QUERY, [IDS.supervisor]);
      const employees = employeesRaw as Row[];
      const dias = await loadFrancoDias(c, employees.map((e) => e.id));

      const alerts = computeFrancoAlerts(employees, dias, HOY);

      expect(alerts.some((a) => a.employeeId === IDS.employee1)).toBe(true);
      expect(alerts.some((a) => a.employeeId === IDS.employee3)).toBe(false);
    });
  });

  it('supervisor2: ve la alerta de employee3 (su equipo), NADA de employee1 (equipo ajeno)', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const { rows: employeesRaw } = await c.query(SUPERVISOR_EMPLOYEES_QUERY, [IDS.supervisor2]);
      const employees = employeesRaw as Row[];
      const dias = await loadFrancoDias(c, employees.map((e) => e.id));

      const alerts = computeFrancoAlerts(employees, dias, HOY);

      expect(alerts.some((a) => a.employeeId === IDS.employee3)).toBe(true);
      expect(alerts.some((a) => a.employeeId === IDS.employee1)).toBe(false);
    });
  });
});
