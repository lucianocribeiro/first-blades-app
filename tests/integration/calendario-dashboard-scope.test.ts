/**
 * Test de integración DB-backed — scope por rol del dashboard de motivos
 * de ausencia (FB-F3-08).
 *
 * El dashboard es una agregación pura (computeMotivoDashboard, ver
 * app/(app)/calendario/utils.ts) sobre los mismos `employees`/`assignments`
 * que ya trae page.tsx con el scope de app superpuesto a la RLS (mismo
 * patrón que tests/integration/calendario-scope.test.ts para la grilla).
 * Este test replica, bajo asUser() con el JWT real de cada rol, la MISMA
 * query de `profiles` que arma page.tsx + la query de `rotation_assignments`
 * (in user_id, rango de fecha), y verifica que el resultado de
 * computeMotivoDashboard coincide exactamente con el scope de la grilla:
 *   - admin: todos los empleados/supervisores visibles (no incluye admin)
 *   - supervisor: su equipo + sí mismo, NADA del equipo ajeno
 *   - empleado: solo su propia fila
 * El bloqueo se prueba por query real bajo RLS, no por UI.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';
import { computeMotivoDashboard, getDaysInMonth } from '@/app/(app)/calendario/utils';
import type { EstadoDia, MotivoAusencia } from '@/lib/db-types';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

const JULY_DAYS = getDaysInMonth(2026, 7);
const FIRST_DAY = JULY_DAYS[0];
const LAST_DAY = JULY_DAYS[JULY_DAYS.length - 1];

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

const EMPLOYEE_EMPLOYEES_QUERY = `
  SELECT id, full_name, email FROM profiles
  WHERE status = 'activo' AND id = $1
  ORDER BY full_name
`;

const ASSIGNMENTS_QUERY = `
  SELECT user_id, fecha::text, estado_dia, motivo_ausencia
  FROM rotation_assignments
  WHERE user_id = ANY($1::uuid[]) AND fecha >= $2 AND fecha <= $3
`;

type Row = { id: string; full_name: string | null; email: string };

type AssignmentRow = { user_id: string; fecha: string; estado_dia: EstadoDia; motivo_ausencia: MotivoAusencia | null };

async function loadAssignments(c: Client, employeeIds: string[]): Promise<AssignmentRow[]> {
  const { rows } = await c.query(ASSIGNMENTS_QUERY, [employeeIds, FIRST_DAY, LAST_DAY]);
  return rows as AssignmentRow[];
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // Sembrado directo (conexión superusuario, sin RLS) — misma forma que el
  // resto de setupTestDb: no está envuelto en una transacción que se
  // revierte, así que persiste para todas las corridas de asUser() del
  // archivo (cada asUser abre su propia transacción de solo-lectura y hace
  // ROLLBACK al final, no afecta lo ya commiteado acá).
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia) VALUES
      ($1, '2026-07-01', 'periodo_fuera_trabajo', 'vacaciones'),
      ($1, '2026-07-02', 'periodo_fuera_trabajo', 'vacaciones'),
      ($2, '2026-07-05', 'periodo_fuera_trabajo', 'licencia_medica'),
      ($3, '2026-07-10', 'periodo_fuera_trabajo', 'matrimonio')
    `,
    [IDS.employee1, IDS.employee2, IDS.employee3]
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

describe.skipIf(!dbAvailable)('scope del dashboard de motivos por rol (DB-backed)', () => {
  it('admin: ve el desglose de todos los empleados/supervisores visibles (no a sí mismo)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: employeesRaw } = await c.query(ADMIN_EMPLOYEES_QUERY);
      const employees = employeesRaw as Row[];
      const assignments = await loadAssignments(c, employees.map((e) => e.id));

      const dashboard = computeMotivoDashboard(employees, assignments, JULY_DAYS);
      const byId = new Map(dashboard.map((r) => [r.employeeId, r]));

      expect(dashboard).toHaveLength(5);
      expect(byId.has(IDS.admin)).toBe(false);
      expect(byId.get(IDS.employee1)?.counts.vacaciones).toBe(2);
      expect(byId.get(IDS.employee2)?.counts.licencia_medica).toBe(1);
      expect(byId.get(IDS.employee3)?.counts.matrimonio).toBe(1);
      expect(byId.get(IDS.supervisor)?.total).toBe(0);
    });
  });

  it('supervisor: ve su equipo + sí mismo, y NADA del equipo ajeno (employee3 no aparece)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows: employeesRaw } = await c.query(SUPERVISOR_EMPLOYEES_QUERY, [IDS.supervisor]);
      const employees = employeesRaw as Row[];
      const assignments = await loadAssignments(c, employees.map((e) => e.id));

      const dashboard = computeMotivoDashboard(employees, assignments, JULY_DAYS);
      const byId = new Map(dashboard.map((r) => [r.employeeId, r]));

      expect(dashboard).toHaveLength(3);
      expect(byId.get(IDS.employee1)?.counts.vacaciones).toBe(2);
      expect(byId.get(IDS.employee2)?.counts.licencia_medica).toBe(1);
      expect(byId.get(IDS.supervisor)?.total).toBe(0);
      expect(byId.has(IDS.employee3)).toBe(false);
      expect(byId.has(IDS.supervisor2)).toBe(false);
    });
  });

  it('supervisor2: ve solo su propio equipo (employee3) + sí mismo', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const { rows: employeesRaw } = await c.query(SUPERVISOR_EMPLOYEES_QUERY, [IDS.supervisor2]);
      const employees = employeesRaw as Row[];
      const assignments = await loadAssignments(c, employees.map((e) => e.id));

      const dashboard = computeMotivoDashboard(employees, assignments, JULY_DAYS);
      const byId = new Map(dashboard.map((r) => [r.employeeId, r]));

      expect(dashboard).toHaveLength(2);
      expect(byId.get(IDS.employee3)?.counts.matrimonio).toBe(1);
      expect(byId.has(IDS.employee1)).toBe(false);
      expect(byId.has(IDS.employee2)).toBe(false);
    });
  });

  it('empleado: ve exactamente su propia fila, con sus propios días', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows: employeesRaw } = await c.query(EMPLOYEE_EMPLOYEES_QUERY, [IDS.employee1]);
      const employees = employeesRaw as Row[];
      const assignments = await loadAssignments(c, employees.map((e) => e.id));

      const dashboard = computeMotivoDashboard(employees, assignments, JULY_DAYS);

      expect(dashboard).toHaveLength(1);
      expect(dashboard[0].employeeId).toBe(IDS.employee1);
      expect(dashboard[0].counts.vacaciones).toBe(2);
      expect(dashboard[0].total).toBe(2);
    });
  });
});
