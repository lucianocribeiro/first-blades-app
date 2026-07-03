/**
 * Test de integración DB-backed — upsert de rotation_assignments (FB-F3-05,
 * cierra el bloqueante de cobertura de FB-F3-AUD-04).
 *
 * FB-F3-04 solo verificaba con un mock que la action llamaba a
 * .upsert(payload, { onConflict: 'user_id,fecha' }). Esto corre la MISMA
 * sentencia que Postgrest genera para ese upsert (INSERT ... ON CONFLICT
 * (user_id, fecha) DO UPDATE) contra un Postgres real, bajo el rol admin
 * real (asUser + RLS, no service_role), y demuestra el efecto: create
 * inserta una fila; un segundo upsert sobre el mismo (user_id, fecha)
 * actualiza esa fila sin duplicarla — UNIQUE (user_id, fecha), migración
 * 0009 (ya cubierta a nivel de constraint en migration.test.ts; esto
 * verifica el comportamiento del upsert, no solo que el constraint exista).
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// Misma forma que el upsert real de app/(app)/calendario/actions.ts
// (.upsert(payload, { onConflict: 'user_id,fecha' })).
const UPSERT_SQL = `
  INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado, motivo_ausencia, motivo_otros_texto)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (user_id, fecha) DO UPDATE SET
    estado_dia = EXCLUDED.estado_dia,
    es_estimado = EXCLUDED.es_estimado,
    motivo_ausencia = EXCLUDED.motivo_ausencia,
    motivo_otros_texto = EXCLUDED.motivo_otros_texto,
    updated_at = now()
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

describe.skipIf(!dbAvailable)('upsert de rotation_assignments (DB-backed, admin real)', () => {
  it('create: upsert de un día sin asignación previa inserta una fila', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-08-01', 'trabajando', false, null, null]);

      const { rows } = await c.query(
        `SELECT estado_dia FROM rotation_assignments WHERE user_id = $1 AND fecha = $2`,
        [IDS.employee2, '2026-08-01']
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].estado_dia).toBe('trabajando');
    });
  });

  it('update: un segundo upsert sobre el mismo (user_id, fecha) actualiza sin duplicar', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-08-02', 'trabajando', false, null, null]);
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-08-02', 'en_franco', false, null, null]);

      const { rows } = await c.query(
        `SELECT estado_dia FROM rotation_assignments WHERE user_id = $1 AND fecha = $2`,
        [IDS.employee2, '2026-08-02']
      );
      // UNIQUE (user_id, fecha): sigue habiendo exactamente 1 fila, con el estado actualizado.
      expect(rows).toHaveLength(1);
      expect(rows[0].estado_dia).toBe('en_franco');
    });
  });

  it('update con motivo: pasar a periodo_fuera_trabajo con motivo actualiza motivo_ausencia sin duplicar', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(UPSERT_SQL, [IDS.employee3, '2026-08-03', 'trabajando', false, null, null]);
      await c.query(UPSERT_SQL, [IDS.employee3, '2026-08-03', 'periodo_fuera_trabajo', false, 'vacaciones', null]);

      const { rows } = await c.query(
        `SELECT estado_dia, motivo_ausencia FROM rotation_assignments WHERE user_id = $1 AND fecha = $2`,
        [IDS.employee3, '2026-08-03']
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].estado_dia).toBe('periodo_fuera_trabajo');
      expect(rows[0].motivo_ausencia).toBe('vacaciones');
    });
  });

  it('create y update no cambian el total de filas de otros días (sin efectos cruzados)', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-08-04', 'trabajando', false, null, null]);
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-08-05', 'en_viaje', false, null, null]);
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-08-04', 'en_franco', false, null, null]); // update solo del día 04

      const { rows } = await c.query(
        `SELECT fecha, estado_dia FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2026-08-04', '2026-08-05') ORDER BY fecha`,
        [IDS.employee2]
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ estado_dia: 'en_franco' });
      expect(rows[1]).toMatchObject({ estado_dia: 'en_viaje' });
    });
  });
});
