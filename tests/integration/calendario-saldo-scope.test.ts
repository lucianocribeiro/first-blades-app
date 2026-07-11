/**
 * Test de integración DB-backed — scope por rol del panel de saldo de días
 * de trámite (FB-F3-21).
 *
 * Mismo patrón que tests/integration/calendario-franco-scope.test.ts:
 * replica bajo asUser() la MISMA query de `profiles` que arma page.tsx
 * (scope de app superpuesto a la RLS) más la nueva query de
 * `rotation_assignments` acotada al año calendario + motivo_ausencia =
 * 'dia_tramite', y verifica que computeSaldoDiasTramite sobre ese
 * resultado coincide con el scope de la grilla para admin y supervisor. El
 * bloqueo se prueba por query real bajo RLS, no por UI — "empleado no ve
 * el panel" es una decisión de producto en page.tsx (unit, no DB), cubierta
 * en tests/unit/calendario-server-boundary.test.ts.
 *
 * Se usa un año fijo (no el real del sistema) para que el test sea
 * determinístico: se le pasa explícitamente a getYearRange(), igual que
 * page.tsx le pasaría getBusinessToday() en producción.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';
import {
  computeSaldoDiasTramite,
  getYearRange,
  type DiaTramiteRow,
} from '@/lib/rotation/saldo-dias-tramite';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

const HOY = '2027-06-15';
const { start: YEAR_START, end: YEAR_END } = getYearRange(HOY);

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

type Row = { id: string; full_name: string | null; email: string };

async function loadDiasTramite(c: Client, employeeIds: string[]): Promise<DiaTramiteRow[]> {
  const { rows } = await c.query(
    `SELECT user_id, fecha::text, es_estimado
     FROM rotation_assignments
     WHERE user_id = ANY($1::uuid[])
       AND motivo_ausencia = 'dia_tramite'
       AND fecha >= $2 AND fecha <= $3`,
    [employeeIds, YEAR_START, YEAR_END]
  );
  return rows as DiaTramiteRow[];
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // employee1 (equipo de supervisor): 4 días de trámite este año → excede
  // el tope de 3. Uno de ellos es_estimado=true (cuenta igual, a propósito).
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado) VALUES
      ($1, '2027-01-10', 'periodo_fuera_trabajo', 'dia_tramite', false),
      ($1, '2027-02-10', 'periodo_fuera_trabajo', 'dia_tramite', false),
      ($1, '2027-03-10', 'periodo_fuera_trabajo', 'dia_tramite', false),
      ($1, '2027-09-10', 'periodo_fuera_trabajo', 'dia_tramite', true)`,
    [IDS.employee1]
  );

  // employee3 (equipo de supervisor2): 1 día de trámite este año + 1 del
  // año anterior (no debe contar) → 1 consumido, no excedido.
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado) VALUES
      ($1, '2027-04-05', 'periodo_fuera_trabajo', 'dia_tramite', false),
      ($1, '2026-12-20', 'periodo_fuera_trabajo', 'dia_tramite', false)`,
    [IDS.employee3]
  );
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

describe.skipIf(!dbAvailable)('scope del panel de saldo de días de trámite por rol (DB-backed)', () => {
  it('admin: ve el saldo de employee1 (excedido, 4/3) y employee3 (1 consumido, año anterior excluido)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: employeesRaw } = await c.query(ADMIN_EMPLOYEES_QUERY);
      const employees = employeesRaw as Row[];
      const dias = await loadDiasTramite(c, employees.map((e) => e.id));

      const saldo = computeSaldoDiasTramite(employees, dias);
      const byEmployee = new Map(saldo.map((s) => [s.employeeId, s]));

      expect(byEmployee.get(IDS.employee1)?.consumidos).toBe(4);
      expect(byEmployee.get(IDS.employee1)?.excedido).toBe(true);
      // El día es_estimado=true (2027-09-10) cuenta igual (regla opuesta a
      // franco) y se propaga como metadata de display en `fechas`.
      expect(byEmployee.get(IDS.employee1)?.fechas).toContainEqual({ fecha: '2027-09-10', esEstimado: true });
      expect(byEmployee.get(IDS.employee3)?.consumidos).toBe(1);
      expect(byEmployee.get(IDS.employee3)?.excedido).toBe(false);
      expect(byEmployee.get(IDS.employee3)?.fechas).toEqual([{ fecha: '2027-04-05', esEstimado: false }]);
    });
  });

  it('supervisor: ve el saldo de employee1 (su equipo), NADA de employee3 (equipo ajeno)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows: employeesRaw } = await c.query(SUPERVISOR_EMPLOYEES_QUERY, [IDS.supervisor]);
      const employees = employeesRaw as Row[];
      const dias = await loadDiasTramite(c, employees.map((e) => e.id));

      const saldo = computeSaldoDiasTramite(employees, dias);

      expect(saldo.some((s) => s.employeeId === IDS.employee1)).toBe(true);
      expect(saldo.some((s) => s.employeeId === IDS.employee3)).toBe(false);
    });
  });

  it('supervisor2: ve el saldo de employee3 (su equipo), NADA de employee1 (equipo ajeno)', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const { rows: employeesRaw } = await c.query(SUPERVISOR_EMPLOYEES_QUERY, [IDS.supervisor2]);
      const employees = employeesRaw as Row[];
      const dias = await loadDiasTramite(c, employees.map((e) => e.id));

      const saldo = computeSaldoDiasTramite(employees, dias);

      expect(saldo.some((s) => s.employeeId === IDS.employee3)).toBe(true);
      expect(saldo.some((s) => s.employeeId === IDS.employee1)).toBe(false);
    });
  });

  // FB-F3-21: page.tsx decide NO ejecutar esta query ni renderizar el
  // panel para empleado (cubierto en tests/unit/calendario-server-boundary.test.ts,
  // que sí puede invocar el Server Component). Acá, bajo asUser real, se
  // agrega la capa complementaria DB-backed: si por error se ejecutara la
  // misma query que arma page.tsx (defensa en profundidad), el scope de
  // app + la RLS igual acotan el resultado a la propia fila.
  it('empleado: aunque se ejecutara la query (defensa en profundidad), solo trae su propio saldo — nunca el de su supervisor ni el de un compañero', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows: employeesRaw } = await c.query(EMPLOYEE_EMPLOYEES_QUERY, [IDS.employee1]);
      const employees = employeesRaw as Row[];
      expect(employees).toEqual([{ id: IDS.employee1, full_name: 'Empleado 1', email: 'emp1@test.com' }]);

      const dias = await loadDiasTramite(c, employees.map((e) => e.id));
      const saldo = computeSaldoDiasTramite(employees, dias);

      expect(saldo.every((s) => s.employeeId === IDS.employee1)).toBe(true);
      expect(saldo.some((s) => s.employeeId === IDS.supervisor)).toBe(false);
      expect(saldo.some((s) => s.employeeId === IDS.employee2)).toBe(false);
      expect(saldo.some((s) => s.employeeId === IDS.employee3)).toBe(false);
      expect(saldo[0]?.consumidos).toBe(4);
      expect(saldo[0]?.excedido).toBe(true);
    });
  });
});
