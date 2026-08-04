/**
 * Tests de integración — RPCs transaccionales crear_aprobar_ausencia_admin /
 * crear_aprobar_pasaje_admin (FB-ADJ-02, migración 0019)
 *
 * FB-ADJ-02 es el fix del Hallazgo Alto de FB-ADJ-AUD-01: la secuencia
 * original de FB-ADJ-01 para el envío de admin-para-sí era dos llamadas
 * separadas desde la Server Action (insert(pendiente) → resolver(aprobar) →
 * DELETE de compensación si fallaba), con una ventana real de solicitud
 * huérfana ante un crash, timeout, o fallo del propio DELETE entre medio.
 * Estas RPCs la reemplazan: insertan y aprueban (invocando la resolver
 * existente por PERFORM, sin duplicar su lógica) en UN solo statement — no
 * hay commit intermedio que compensar, así que estos tests, contra Postgres
 * real bajo `asUser(IDS.admin, ...)` (rol `authenticated` + claims de admin,
 * el camino de ejecución real), cubren:
 *
 *  1. Happy path (ambos tipos): la solicitud queda `aprobado` de una,
 *     `reviewed_by`/`reviewed_at` = el propio admin, calendario escrito
 *     (`periodo_fuera_trabajo`/`en_viaje`), `audit_log` completo, y nunca
 *     pasa por un estado `pendiente` observable (no aparecería en
 *     Aprobaciones).
 *  2. Guardas §6.1 (idénticas a resolver_ausencia_request/resolver_pasaje_
 *     request): no-admin (empleado/supervisor) y anon (GRANT) bloqueados.
 *  3. Rollback total ante fallo — el reemplazo directo del test de "huérfana
 *     aceptada" de FB-ADJ-01 (ya no es un caso válido: la atomicidad lo
 *     elimina). Un fallo forzado DENTRO de la resolver anidada (colisión de
 *     calendario vía un CHECK temporal, mismo fixture que
 *     resolver-ausencia-request.test.ts / resolver-pasaje-request.test.ts)
 *     revierte también el INSERT de la request que hizo el wrapper — no
 *     queda ni la solicitud, ni el calendario, ni el audit_log. Esta es la
 *     prueba central del fix: antes (FB-ADJ-01) un fallo acá habría dejado
 *     la solicitud `pendiente` colgada (o huérfana si el cleanup también
 *     fallaba); ahora no puede quedar nada a medias.
 *
 * No re-testea las invariantes propias de resolver_ausencia_request/
 * resolver_pasaje_request (expansión de rango/días, colisión de calendario,
 * atomicidad de SU propia lógica) — eso ya está cubierto en
 * resolver-ausencia-request.test.ts / resolver-pasaje-request.test.ts. Acá
 * se prueba específicamente que el wrapper nuevo compone bien con la
 * resolver existente dentro de una sola transacción.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS, DB_URL } from './helpers';

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

/** Conexión como anon (sin sesión): para probar que el GRANT bloquea antes de la guarda interna. */
async function asAnon<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE anon');
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

/**
 * Espera que la invocación falle, y deja la transacción utilizable después
 * (mismo patrón que resolver-ausencia-request.test.ts / resolver-pasaje-
 * request.test.ts): un RAISE EXCEPTION no capturado aborta la transacción;
 * un SAVEPOINT antes + ROLLBACK TO SAVEPOINT después permite seguir
 * verificando que no quedaron efectos parciales en la misma transacción.
 */
async function callExpectingThrow(client: Client, sql: string, params: unknown[]): Promise<void> {
  await client.query('SAVEPOINT sp_call');
  try {
    await expect(client.query(sql, params as string[])).rejects.toThrow();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT sp_call');
  }
}

// ─── crear_aprobar_ausencia_admin ──────────────────────────────────────────

describe.skipIf(!dbAvailable)('crear_aprobar_ausencia_admin: happy path', () => {
  it('crea y aprueba en una sola llamada: aprobado, calendario y audit_log escritos, nunca queda pendiente', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(
        `SELECT public.crear_aprobar_ausencia_admin($1, $2, $3, NULL, $4) AS id`,
        ['vacaciones', '2027-07-01', '2027-07-02', 'nota de prueba admin']
      );
      const requestId = rows[0].id;

      const { rows: reqRows } = await c.query(
        `SELECT estado, reviewed_by, reviewed_at, notas, user_id FROM ausencia_requests WHERE id = $1`,
        [requestId]
      );
      expect(reqRows[0].estado).toBe('aprobado');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);
      expect(reqRows[0].reviewed_at).not.toBeNull();
      expect(reqRows[0].notas).toBe('nota de prueba admin');
      expect(reqRows[0].user_id).toBe(IDS.admin);

      const { rows: calRows } = await c.query(
        `SELECT estado_dia, motivo_ausencia FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-07-01' AND '2027-07-02' ORDER BY fecha`,
        [IDS.admin]
      );
      expect(calRows).toHaveLength(2);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('periodo_fuera_trabajo');
        expect(row.motivo_ausencia).toBe('vacaciones');
      }

      const { rows: auditRows } = await c.query(
        `SELECT action, actor_id FROM audit_log WHERE record_id = $1`,
        [requestId]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('ausencia_approved');
      expect(auditRows[0].actor_id).toBe(IDS.admin);

      const { rows: pendienteRows } = await c.query(
        `SELECT id FROM ausencia_requests WHERE id = $1 AND estado = 'pendiente'`,
        [requestId]
      );
      expect(pendienteRows).toHaveLength(0);
    });
  });
});

describe.skipIf(!dbAvailable)('crear_aprobar_ausencia_admin: guardas', () => {
  it('empleado (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(`SELECT public.crear_aprobar_ausencia_admin($1, $2, $3, NULL, NULL)`, ['vacaciones', '2027-07-05', '2027-07-05'])
      ).rejects.toThrow();
    });
  });

  it('supervisor (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expect(
        c.query(`SELECT public.crear_aprobar_ausencia_admin($1, $2, $3, NULL, NULL)`, ['vacaciones', '2027-07-06', '2027-07-06'])
      ).rejects.toThrow();
    });
  });

  it('anon no puede ejecutar la función (GRANT lo bloquea antes de la guarda interna)', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.crear_aprobar_ausencia_admin($1, $2, $3, NULL, NULL)`, ['vacaciones', '2027-07-07', '2027-07-07'])
      ).rejects.toThrow();
    });
  });
});

describe.skipIf(!dbAvailable)('crear_aprobar_ausencia_admin: rollback total ante fallo (FB-ADJ-02)', () => {
  it('un fallo forzado en la escritura del calendario (dentro de la resolver anidada) revierte TODO — ni la solicitud, ni el calendario, ni el audit_log persisten', async () => {
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    try {
      await setupClient.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_admin_ausencia CHECK (fecha <> '2027-08-15')
      `);

      // Paso afirmado: corre bajo asUser(IDS.admin) — rol authenticated +
      // claims de admin, el camino de ejecución real de la RPC.
      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(
          c,
          `SELECT public.crear_aprobar_ausencia_admin($1, $2, $3, NULL, NULL)`,
          ['vacaciones', '2027-08-15', '2027-08-15']
        );

        // Ni siquiera el INSERT del wrapper (previo a la resolver anidada)
        // sobrevive — es la prueba central del fix FB-ADJ-02.
        const { rows: reqRows } = await c.query(
          `SELECT id FROM ausencia_requests WHERE user_id = $1 AND fecha_inicio = '2027-08-15'`,
          [IDS.admin]
        );
        expect(reqRows).toHaveLength(0);

        const { rows: calRows } = await c.query(
          `SELECT id FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-08-15'`,
          [IDS.admin]
        );
        expect(calRows).toHaveLength(0);

        const { rows: auditRows } = await c.query(
          `SELECT id FROM audit_log WHERE actor_id = $1 AND action = 'ausencia_approved' AND created_at > now() - interval '1 minute'`,
          [IDS.admin]
        );
        expect(auditRows).toHaveLength(0);
      });
    } finally {
      await setupClient.query(`ALTER TABLE rotation_assignments DROP CONSTRAINT IF EXISTS test_force_fail_admin_ausencia`);
      await setupClient.end();
    }
  });
});

// ─── crear_aprobar_pasaje_admin ────────────────────────────────────────────

describe.skipIf(!dbAvailable)('crear_aprobar_pasaje_admin: happy path', () => {
  it('crea y aprueba en una sola llamada: aprobado, calendario y audit_log escritos, nunca queda pendiente', async () => {
    await asUser(IDS.admin, async (c) => {
      // dias_viaje se inlinea como ARRAY[...]::date[] (no vía placeholder
      // $n) — mismo criterio que cancelar-editar-post-aprobacion.test.ts
      // para pasarle un date[] a una función plpgsql desde node-pg.
      const { rows } = await c.query(
        `SELECT public.crear_aprobar_pasaje_admin($1, $2, $3, ARRAY['2027-07-10','2027-07-11']::date[], $4) AS id`,
        ['traslado_proyectos', 'Base', 'Sitio', 'nota de prueba admin']
      );
      const requestId = rows[0].id;

      const { rows: reqRows } = await c.query(
        `SELECT estado, reviewed_by, reviewed_at, notas, solicitante_id, empleado_id, fecha_viaje
         FROM pasaje_requests WHERE id = $1`,
        [requestId]
      );
      expect(reqRows[0].estado).toBe('aprobado');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);
      expect(reqRows[0].reviewed_at).not.toBeNull();
      expect(reqRows[0].notas).toBe('nota de prueba admin');
      expect(reqRows[0].solicitante_id).toBe(IDS.admin);
      expect(reqRows[0].empleado_id).toBe(IDS.admin);
      // fecha_viaje (legacy) = el día más temprano de dias_viaje.
      expect(new Date(reqRows[0].fecha_viaje).toISOString().slice(0, 10)).toBe('2027-07-10');

      const { rows: calRows } = await c.query(
        `SELECT estado_dia FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-07-10' AND '2027-07-11' ORDER BY fecha`,
        [IDS.admin]
      );
      expect(calRows).toHaveLength(2);
      for (const row of calRows) expect(row.estado_dia).toBe('en_viaje');

      const { rows: auditRows } = await c.query(
        `SELECT action, actor_id FROM audit_log WHERE record_id = $1`,
        [requestId]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('pasaje_approved');
      expect(auditRows[0].actor_id).toBe(IDS.admin);

      const { rows: pendienteRows } = await c.query(
        `SELECT id FROM pasaje_requests WHERE id = $1 AND estado = 'pendiente'`,
        [requestId]
      );
      expect(pendienteRows).toHaveLength(0);
    });
  });
});

describe.skipIf(!dbAvailable)('crear_aprobar_pasaje_admin: guardas', () => {
  it('empleado (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(`SELECT public.crear_aprobar_pasaje_admin($1, $2, $3, ARRAY['2027-07-15']::date[], NULL)`, [
          'traslado_proyectos', 'Base', 'Sitio',
        ])
      ).rejects.toThrow();
    });
  });

  it('supervisor (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expect(
        c.query(`SELECT public.crear_aprobar_pasaje_admin($1, $2, $3, ARRAY['2027-07-16']::date[], NULL)`, [
          'traslado_proyectos', 'Base', 'Sitio',
        ])
      ).rejects.toThrow();
    });
  });

  it('anon no puede ejecutar la función (GRANT lo bloquea antes de la guarda interna)', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.crear_aprobar_pasaje_admin($1, $2, $3, ARRAY['2027-07-17']::date[], NULL)`, [
          'traslado_proyectos', 'Base', 'Sitio',
        ])
      ).rejects.toThrow();
    });
  });
});

describe.skipIf(!dbAvailable)('crear_aprobar_pasaje_admin: rollback total ante fallo (FB-ADJ-02)', () => {
  it('un fallo forzado en la escritura del calendario (dentro de la resolver anidada) revierte TODO — ni la solicitud, ni el calendario, ni el audit_log persisten', async () => {
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    try {
      await setupClient.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_admin_pasaje CHECK (fecha <> '2027-08-20')
      `);

      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(
          c,
          `SELECT public.crear_aprobar_pasaje_admin($1, $2, $3, ARRAY['2027-08-20']::date[], NULL)`,
          ['traslado_proyectos', 'Base-test-rollback', 'Sitio-test-rollback']
        );

        const { rows: reqRows } = await c.query(
          `SELECT id FROM pasaje_requests WHERE solicitante_id = $1 AND origen = 'Base-test-rollback'`,
          [IDS.admin]
        );
        expect(reqRows).toHaveLength(0);

        const { rows: calRows } = await c.query(
          `SELECT id FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-08-20'`,
          [IDS.admin]
        );
        expect(calRows).toHaveLength(0);

        const { rows: auditRows } = await c.query(
          `SELECT id FROM audit_log WHERE actor_id = $1 AND action = 'pasaje_approved' AND created_at > now() - interval '1 minute'`,
          [IDS.admin]
        );
        expect(auditRows).toHaveLength(0);
      });
    } finally {
      await setupClient.query(`ALTER TABLE rotation_assignments DROP CONSTRAINT IF EXISTS test_force_fail_admin_pasaje`);
      await setupClient.end();
    }
  });

  it('CHECK de columna (dias_viaje no-vacío) también revierte todo — ni siquiera el INSERT del wrapper sobrevive', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.crear_aprobar_pasaje_admin($1, $2, $3, ARRAY[]::date[], NULL)`,
        ['traslado_proyectos', 'Base-test-checkvacio', 'Sitio-test-checkvacio']
      );

      const { rows } = await c.query(
        `SELECT id FROM pasaje_requests WHERE solicitante_id = $1 AND origen = 'Base-test-checkvacio'`,
        [IDS.admin]
      );
      expect(rows).toHaveLength(0);
    });
  });
});
