/**
 * Tests de integración — invariantes de purgatorio en ausencia_requests (FB-F3-14)
 *
 * Cubre contra Supabase local real (migración 0012):
 *  1. CHECK ausencia_requests_rechazo_requiere_motivo: una fila rechazada
 *     SIEMPRE tiene motivo_rechazo no vacío.
 *  2. CHECK ausencia_requests_resolucion_completa: una fila resuelta
 *     (aprobado/rechazado) SIEMPRE tiene reviewed_by + reviewed_at.
 *
 * El no-solapamiento de rangos pendientes (originalmente un índice único
 * parcial exacto por fecha/motivo, reemplazado en 0014 por una exclusion
 * constraint de rangos) se cubre en tests/integration/ausencia-no-solapamiento.test.ts
 * (FB-F4-01).
 *
 * Las pruebas de RLS (quién puede insertar/leer/actualizar) viven en
 * tests/integration/rls.test.ts — este archivo cubre solo los constraints
 * de la tabla, insertando como service_role (bypass RLS) para aislar el
 * comportamiento del catálogo del comportamiento de policies.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { setupTestDb, IDS, asServiceRole } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

// ─── CHECK: rechazo requiere motivo ────────────────────────────

describe.skipIf(!dbAvailable)('ausencia_requests: CHECK rechazo_requiere_motivo (FB-F3-14)', () => {
  it('rechaza una fila rechazada sin motivo_rechazo', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO ausencia_requests
             (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
           VALUES ($1::uuid, 'dia_tramite', '2026-08-01', '2026-08-01', 'rechazado', $2::uuid, now())`,
          [IDS.employee1, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('rechaza una fila rechazada con motivo_rechazo vacío/blanco', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO ausencia_requests
             (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, motivo_rechazo, reviewed_by, reviewed_at)
           VALUES ($1::uuid, 'dia_tramite', '2026-08-01', '2026-08-01', 'rechazado', '   ', $2::uuid, now())`,
          [IDS.employee1, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('acepta una fila rechazada con motivo_rechazo no vacío', async () => {
    await asServiceRole(async (client) => {
      const res = await client.query(
        `INSERT INTO ausencia_requests
           (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, motivo_rechazo, reviewed_by, reviewed_at)
         VALUES ($1::uuid, 'dia_tramite', '2026-08-01', '2026-08-01', 'rechazado', 'Falta documentación', $2::uuid, now())
         RETURNING id`,
        [IDS.employee1, IDS.admin]
      );
      expect(res.rows).toHaveLength(1);
    });
  });
});

// ─── CHECK: resolución completa ────────────────────────────────

describe.skipIf(!dbAvailable)('ausencia_requests: CHECK resolucion_completa (FB-F3-14)', () => {
  it('rechaza una fila aprobada sin reviewed_by ni reviewed_at', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO ausencia_requests
             (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
           VALUES ($1::uuid, 'dia_tramite', '2026-08-02', '2026-08-02', 'aprobado')`,
          [IDS.employee1]
        );
      })
    ).rejects.toThrow();
  });

  it('rechaza una fila rechazada con motivo pero sin reviewed_by/reviewed_at', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO ausencia_requests
             (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, motivo_rechazo)
           VALUES ($1::uuid, 'dia_tramite', '2026-08-02', '2026-08-02', 'rechazado', 'Falta documentación')`,
          [IDS.employee1]
        );
      })
    ).rejects.toThrow();
  });

  it('acepta una fila pendiente sin reviewed_by/reviewed_at (default)', async () => {
    await asServiceRole(async (client) => {
      const res = await client.query(
        `INSERT INTO ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin)
         VALUES ($1::uuid, 'dia_tramite', '2026-08-02', '2026-08-02')
         RETURNING id, estado`,
        [IDS.employee1]
      );
      expect(res.rows[0].estado).toBe('pendiente');
    });
  });

  it('acepta una fila aprobada con reviewed_by y reviewed_at', async () => {
    await asServiceRole(async (client) => {
      const res = await client.query(
        `INSERT INTO ausencia_requests
           (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
         VALUES ($1::uuid, 'dia_tramite', '2026-08-03', '2026-08-03', 'aprobado', $2::uuid, now())
         RETURNING id`,
        [IDS.employee1, IDS.admin]
      );
      expect(res.rows).toHaveLength(1);
    });
  });
});
