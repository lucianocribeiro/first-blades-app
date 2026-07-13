/**
 * Test de integración DB-backed — pintado por rango de rotation_assignments
 * (FB-F3-23, upsertRotationRange).
 *
 * Mismo mecanismo de escritura que el upsert de celda única
 * (tests/integration/calendario-upsert.test.ts): la MISMA sentencia que
 * Postgrest genera para cada día del rango (INSERT ... ON CONFLICT
 * (user_id, fecha) DO UPDATE), corrida N veces contra un Postgres real, bajo
 * el rol admin real (asUser + RLS).
 *
 * El caso de "fallo parcial" reproduce a nivel de base la propiedad
 * best-effort de la action: en producción cada upsert() del admin es un
 * request PostgREST independiente (su propia transacción autocommit), así
 * que un día que viola el CHECK real (periodo_fuera_trabajo sin motivo) NO
 * aborta los demás días del rango. Dentro de una única conexión de test
 * (asUser abre UNA transacción y hace ROLLBACK al final, ver helpers.ts) se
 * reproduce ese aislamiento por statement con SAVEPOINT/ROLLBACK TO
 * SAVEPOINT alrededor de cada día — sin eso, el error de un día dejaría la
 * transacción entera abortada y los días siguientes fallarían en cascada,
 * algo que NO pasa en producción (ahí cada día es su propio request).
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// Misma forma que cada upsert por día de app/(app)/calendario/actions.ts::upsertRotationRange
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

describe.skipIf(!dbAvailable)('pintado por rango de rotation_assignments (DB-backed, admin real)', () => {
  it('rango feliz: N días consecutivos sin asignación previa quedan todos con el mismo estado', async () => {
    await asUser(IDS.admin, async (c) => {
      const fechas = ['2026-09-01', '2026-09-02', '2026-09-03'];
      for (const fecha of fechas) {
        await c.query(UPSERT_SQL, [IDS.employee2, fecha, 'trabajando', false, null, null]);
      }

      const { rows } = await c.query(
        `SELECT fecha, estado_dia FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2026-09-01','2026-09-02','2026-09-03') ORDER BY fecha`,
        [IDS.employee2]
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.estado_dia === 'trabajando')).toBe(true);
    });
  });

  it('cada día del rango puede tener su propio es_estimado (pasado real, futuro planificado)', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-09-10', 'en_franco', false, null, null]); // real
      await c.query(UPSERT_SQL, [IDS.employee2, '2026-09-11', 'en_franco', true, null, null]); // planificado

      const { rows } = await c.query(
        `SELECT fecha, es_estimado FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2026-09-10','2026-09-11') ORDER BY fecha`,
        [IDS.employee2]
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].es_estimado).toBe(false);
      expect(rows[1].es_estimado).toBe(true);
    });
  });

  it('pisado: el rango sobreescribe estados previos de esas celdas sin duplicar filas', async () => {
    await asUser(IDS.admin, async (c) => {
      // Estado previo (simula celdas ya cargadas antes del pintado por rango).
      await c.query(UPSERT_SQL, [IDS.employee3, '2026-09-05', 'en_viaje', false, null, null]);
      await c.query(UPSERT_SQL, [IDS.employee3, '2026-09-06', 'trabajando', false, null, null]);

      // Pintado por rango: mismo estado para ambos días, pisa lo anterior.
      await c.query(UPSERT_SQL, [IDS.employee3, '2026-09-05', 'en_franco', false, null, null]);
      await c.query(UPSERT_SQL, [IDS.employee3, '2026-09-06', 'en_franco', false, null, null]);

      const { rows } = await c.query(
        `SELECT fecha, estado_dia FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2026-09-05','2026-09-06') ORDER BY fecha`,
        [IDS.employee3]
      );
      // UNIQUE (user_id, fecha): sigue habiendo exactamente 1 fila por día, con el estado nuevo.
      expect(rows).toHaveLength(2);
      expect(rows[0].estado_dia).toBe('en_franco');
      expect(rows[1].estado_dia).toBe('en_franco');
    });
  });

  it('fallo parcial real: un día que viola el CHECK de motivo requerido no aborta los demás días del rango', async () => {
    await asUser(IDS.admin, async (c) => {
      const dias = [
        { fecha: '2026-09-20', estado: 'trabajando' },
        { fecha: '2026-09-21', estado: 'periodo_fuera_trabajo' }, // sin motivo → viola el CHECK real
        { fecha: '2026-09-22', estado: 'en_franco' },
      ];

      const applied: string[] = [];
      const failed: string[] = [];

      for (const dia of dias) {
        await c.query('SAVEPOINT day_upsert');
        try {
          await c.query(UPSERT_SQL, [IDS.employee2, dia.fecha, dia.estado, false, null, null]);
          await c.query('RELEASE SAVEPOINT day_upsert');
          applied.push(dia.fecha);
        } catch {
          await c.query('ROLLBACK TO SAVEPOINT day_upsert');
          failed.push(dia.fecha);
        }
      }

      expect(applied).toEqual(['2026-09-20', '2026-09-22']);
      expect(failed).toEqual(['2026-09-21']);

      const { rows } = await c.query(
        `SELECT fecha, estado_dia FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2026-09-20','2026-09-21','2026-09-22') ORDER BY fecha`,
        [IDS.employee2]
      );
      // El día que violó el CHECK nunca se insertó: solo quedan los otros dos.
      expect(rows).toHaveLength(2);
      expect(rows[0].estado_dia).toBe('trabajando');
      expect(rows[1].estado_dia).toBe('en_franco');
    });
  });
});
