/**
 * Tests de integración — no-solapamiento de ausencias pendientes (FB-F4-01)
 *
 * Cubre contra Supabase local real (migración 0014) la exclusion constraint
 * ausencia_requests_no_solapamiento_pendiente: dos solicitudes PENDIENTES
 * del mismo empleado no pueden tener rangos [fecha_inicio, fecha_fin] que
 * se solapen, sin importar el motivo (reemplaza el índice único parcial de
 * 0012, que solo bloqueaba duplicados exactos del mismo motivo).
 *
 * Todas las inserciones que se afirman (los caminos permitidos y los
 * bloqueados) corren bajo JWT real del empleado acotado (`asUser`, o el
 * patrón manual de más abajo cuando hace falta más de una identidad en la
 * misma transacción) — el mismo camino que ejercita la server action de la
 * app. Un cliente privilegiado (`service_role`) solo se usa para el setup
 * indispensable que un no-admin no puede montar por policy: sembrar una
 * fila `estado = 'aprobado'` (`ausencias_insert_non_admin` fuerza
 * `pendiente` para no-admin; en prod esa fila solo la crea
 * `resolver_ausencia_request` (0013), que también es SECURITY DEFINER y
 * bypassea RLS del mismo modo). Nunca se usa privilegio para la inserción
 * que el test está probando (FB-F4-AUD-01, hallazgo Medio).
 *
 * `asUser`/`asServiceRole` (helpers.ts) siempre hacen ROLLBACK al cerrar,
 * así que dos llamadas separadas no se ven entre sí: cuando un escenario
 * necesita que la fila de una identidad sea visible para la inserción de
 * otra identidad (empleado distinto, o setup privilegiado seguido de
 * inserción bajo JWT), ambos pasos corren en la MISMA transacción/conexión,
 * cambiando `request.jwt.claims` (y el `ROLE` cuando hace falta el bypass
 * de setup) a mitad de camino — ver `withSameTxClient` más abajo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { DB_URL, setupTestDb, IDS, asUser } from './helpers';

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

/** Simula el JWT de Supabase Auth del usuario dado para el resto de la transacción (RLS real vía auth.uid()). */
async function actAs(client: Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
}

/**
 * Como asUser/asServiceRole (helpers.ts), pero deja UNA sola conexión
 * abierta para todo el callback en vez de una por llamada, así que
 * insertar como una identidad y después leer/insertar como otra (o
 * intercalar un paso privilegiado de setup) ve las filas de los pasos
 * anteriores — cosa que dos llamadas separadas a asUser/asServiceRole no
 * pueden, porque cada una hace ROLLBACK al cerrar. Siempre hace ROLLBACK
 * al final: no persiste nada más allá del test.
 */
async function withSameTxClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
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

    it('dos empleados distintos pueden tener pendientes con rangos solapados entre sí (la exclusion constraint es por user_id) — ambas inserciones bajo JWT real', async () => {
      await withSameTxClient(async (client) => {
        await client.query('SET LOCAL ROLE authenticated');

        // Setup: empleado1 inserta su propia pendiente. No hace falta
        // privilegio — un no-admin puede insertar la suya sin problema
        // (ausencias_insert_non_admin) — así que ya corre bajo su propio JWT.
        await actAs(client, IDS.employee1);
        await insertPendiente(client, IDS.employee1, 'dia_tramite', '2026-09-10', '2026-09-12');

        // La inserción que se está probando: empleado2, bajo SU PROPIO JWT
        // (no service_role), inserta una pendiente que se solapa en fechas
        // con la de empleado1. La exclusion constraint es por user_id, así
        // que no debe bloquear.
        await actAs(client, IDS.employee2);
        const res = await insertPendiente(client, IDS.employee2, 'dia_tramite', '2026-09-10', '2026-09-12');
        expect(res.rows).toHaveLength(1);
      });
    });

    it('una ausencia APROBADA no bloquea una nueva pendiente que se solapa con ella (el predicado WHERE es solo pendiente-contra-pendiente) — la inserción que se prueba corre bajo JWT real', async () => {
      await withSameTxClient(async (client) => {
        // Setup indispensable con privilegio: ausencias_insert_non_admin
        // fuerza estado = 'pendiente' para no-admin, así que un empleado NO
        // puede sembrar la fila 'aprobado' por su cuenta. service_role es
        // el equivalente de test de resolver_ausencia_request (0013,
        // SECURITY DEFINER), que es quien crea esa fila en prod.
        await client.query('SET LOCAL ROLE service_role');
        await client.query(
          `INSERT INTO ausencia_requests
             (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
           VALUES ($1::uuid, 'vacaciones', '2026-09-20', '2026-09-25', 'aprobado', $2::uuid, now())`,
          [IDS.employee3, IDS.admin]
        );

        // La inserción que se está probando: empleado3, bajo SU PROPIO JWT
        // (RLS real, no service_role), inserta una pendiente que se solapa
        // con la aprobada.
        await client.query('SET LOCAL ROLE authenticated');
        await actAs(client, IDS.employee3);
        const res = await insertPendiente(client, IDS.employee3, 'dia_tramite', '2026-09-23', '2026-09-23');
        expect(res.rows).toHaveLength(1);
      });
    });
  }
);
