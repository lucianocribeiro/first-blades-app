/**
 * Tests de integración — no-solapamiento de ausencias pendientes (FB-F4-01)
 *
 * Cubre contra Supabase local real (migración 0014) la exclusion constraint
 * ausencia_requests_no_solapamiento_pendiente: dos solicitudes PENDIENTES
 * del mismo empleado no pueden tener rangos [fecha_inicio, fecha_fin] que
 * se solapen, sin importar el motivo (reemplaza el índice único parcial de
 * 0012, que solo bloqueaba duplicados exactos del mismo motivo).
 *
 * Los casos donde la fila en conflicto la crea el propio empleado (bloqueo
 * y no-bloqueo de sus propias pendientes) corren bajo JWT real de empleado
 * (asUser), ejercitando RLS + la exclusion constraint juntas — el mismo
 * camino que ejercita la server action de la app. Los casos donde hace
 * falta una fila que un no-admin no puede crear por policy (una ausencia
 * ya `aprobada`, o la fila de un segundo empleado en la misma transacción
 * para probar que no hay conflicto cruzado) corren como service_role, igual
 * que en tests/integration/ausencia-requests-purgatorio.test.ts — mismo
 * criterio: aislar el comportamiento del catálogo del de las policies. Una
 * fila `aprobada` en prod solo la crea resolver_ausencia_request (0013),
 * que también es SECURITY DEFINER y bypassea RLS del mismo modo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { setupTestDb, IDS, asUser, asServiceRole } from './helpers';

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

async function insertPendiente(
  client: Client,
  userId: string,
  motivo: string,
  inicio: string,
  fin: string
) {
  return client.query(
    `INSERT INTO ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin)
     VALUES ($1::uuid, $2::motivo_ausencia, $3::date, $4::date) RETURNING id`,
    [userId, motivo, inicio, fin]
  );
}

describe.skipIf(!dbAvailable)(
  'ausencia_requests_no_solapamiento_pendiente: bloqueo de rangos pendientes solapados (FB-F4-01)',
  () => {
    it.each([
      ['idéntica', '2026-09-01', '2026-09-05'],
      ['contenida', '2026-09-02', '2026-09-03'],
      ['solapa el extremo final (comparten el día 05)', '2026-09-05', '2026-09-08'],
      ['solapa el extremo inicial (comparten el día 01)', '2026-08-28', '2026-09-01'],
    ])(
      'empleado con pendiente [09-01..09-05]: rechaza otra pendiente que se solapa — %s (motivo distinto, igual bloquea)',
      async (_caso, inicio, fin) => {
        await expect(
          asUser(IDS.employee1, async (client) => {
            await insertPendiente(client, IDS.employee1, 'dia_tramite', '2026-09-01', '2026-09-05');
            await insertPendiente(client, IDS.employee1, 'vacaciones', inicio, fin);
          })
        ).rejects.toMatchObject({ code: '23P01' });
      }
    );

    it('empleado con pendiente [09-01..09-05]: permite otra pendiente que NO se solapa', async () => {
      await asUser(IDS.employee1, async (client) => {
        await insertPendiente(client, IDS.employee1, 'dia_tramite', '2026-09-01', '2026-09-05');
        const res = await insertPendiente(client, IDS.employee1, 'vacaciones', '2026-09-06', '2026-09-08');
        expect(res.rows).toHaveLength(1);
      });
    });

    it('dos empleados distintos pueden tener pendientes con rangos solapados entre sí (la exclusion constraint es por user_id)', async () => {
      await asServiceRole(async (client) => {
        await insertPendiente(client, IDS.employee1, 'dia_tramite', '2026-09-10', '2026-09-12');
        const res = await insertPendiente(client, IDS.employee2, 'dia_tramite', '2026-09-10', '2026-09-12');
        expect(res.rows).toHaveLength(1);
      });
    });

    it('una ausencia APROBADA no bloquea una nueva pendiente que se solapa con ella (el predicado WHERE es solo pendiente-contra-pendiente)', async () => {
      await asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO ausencia_requests
             (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
           VALUES ($1::uuid, 'vacaciones', '2026-09-20', '2026-09-25', 'aprobado', $2::uuid, now())`,
          [IDS.employee3, IDS.admin]
        );
        const res = await insertPendiente(client, IDS.employee3, 'dia_tramite', '2026-09-23', '2026-09-23');
        expect(res.rows).toHaveLength(1);
      });
    });
  }
);
