/**
 * Test de integración DB-backed — scope de `profiles` para las vistas de
 * lectura del roster (FB-F3-06).
 *
 * Replica, bajo asUser() con el JWT real de cada rol, la MISMA query que
 * arma app/(app)/calendario/page.tsx para poblar las filas de la grilla:
 *   - supervisor: WHERE status='activo' AND (id = $1 OR supervisor_id = $1)
 *   - empleado:   WHERE status='activo' AND id = $1
 * Verifica el "scope de app superpuesto a la RLS" (aprendizaje de Fase 2,
 * ver tests/integration/rls.test.ts): el supervisor trae su equipo + sí
 * mismo y NADA del equipo ajeno (supervisor2 → employee3); el empleado
 * trae solo su propia fila.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

const SUPERVISOR_QUERY = `
  SELECT id FROM profiles
  WHERE status = 'activo' AND (id = $1 OR supervisor_id = $1)
  ORDER BY full_name
`;

const EMPLOYEE_QUERY = `
  SELECT id FROM profiles
  WHERE status = 'activo' AND id = $1
  ORDER BY full_name
`;

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();
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

describe.skipIf(!dbAvailable)('scope del roster: profiles por rol (DB-backed)', () => {
  it('supervisor: trae su equipo + sí mismo, y NADA del equipo ajeno', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(SUPERVISOR_QUERY, [IDS.supervisor]);
      const ids = rows.map((r) => r.id);

      expect(ids).toContain(IDS.supervisor);
      expect(ids).toContain(IDS.employee1);
      expect(ids).toContain(IDS.employee2);
      expect(ids).toHaveLength(3);

      // Caso negativo: ni el equipo de supervisor2 ni otros roles se filtran
      // por la UI, sino por la query — probar que "0 filas" viene de acá.
      expect(ids).not.toContain(IDS.employee3);
      expect(ids).not.toContain(IDS.supervisor2);
      expect(ids).not.toContain(IDS.admin);
    });
  });

  it('supervisor2: trae solo su propio equipo (employee3) + sí mismo', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const { rows } = await c.query(SUPERVISOR_QUERY, [IDS.supervisor2]);
      const ids = rows.map((r) => r.id);

      expect(ids).toContain(IDS.supervisor2);
      expect(ids).toContain(IDS.employee3);
      expect(ids).toHaveLength(2);
      expect(ids).not.toContain(IDS.employee1);
      expect(ids).not.toContain(IDS.employee2);
    });
  });

  it('empleado: trae exactamente su propia fila (mismo patrón de query que page.tsx)', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query(EMPLOYEE_QUERY, [IDS.employee1]);
      const ids = rows.map((r) => r.id);

      expect(ids).toEqual([IDS.employee1]);
    });
  });
});
