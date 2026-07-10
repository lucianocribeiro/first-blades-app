/**
 * Tests de integración — función resolver_ausencia_request (FB-F3-17)
 *
 * Cubre, contra Postgres real:
 *  1. Happy path: aprobar (estado, audit_log, rotation_assignments) y
 *     rechazar (estado + motivo_rechazo, audit_log, sin tocar el calendario).
 *  2. Guardas: no-admin (empleado/supervisor), anon (grant), solicitud ya
 *     resuelta, rechazo sin motivo (o solo blanco), acción inválida,
 *     solicitud inexistente.
 *  3. Colisión de calendario: aprobar pisa una celda con otro estado_dia ya
 *     cargado, y la queda auditada en el mismo audit_log.
 *  4. Atomicidad: si falla el upsert de rotation_assignments o el INSERT de
 *     audit_log, ausencia_requests NO queda actualizada — todo o nada.
 *
 * No re-testea las policies de RLS de ausencia_requests/rotation_assignments/
 * audit_log en sí (ver rls.test.ts) ni los CHECK/índice de 0012 (ver
 * ausencia-requests-purgatorio.test.ts) — la función es SECURITY DEFINER y
 * bypassea esa RLS a propósito; lo que se prueba acá es su propia guarda
 * interna, que es el control de seguridad real de esta operación.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS, DB_URL } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// IDs fijos de solicitudes de prueba, una por escenario.
const REQ_PENDIENTE            = 'd1000000-0000-0000-0001-000000000001'; // employee1, 2027-02-01 — happy path aprobar + guardas genéricas
const REQ_YA_RESUELTA          = 'd1000000-0000-0000-0001-000000000002'; // employee1, 2027-02-02 — ya aprobada
const REQ_PARA_RECHAZAR        = 'd1000000-0000-0000-0001-000000000003'; // employee1, 2027-02-03 — happy path rechazar
const REQ_COLISION             = 'd1000000-0000-0000-0001-000000000004'; // employee2, 2027-02-04 — celda de calendario ya cargada
const REQ_ATOMICIDAD_CALENDARIO = 'd1000000-0000-0000-0001-000000000005'; // employee3, 2027-02-05
const REQ_ATOMICIDAD_AUDIT      = 'd1000000-0000-0000-0001-000000000006'; // employee3, 2027-02-06

/** Conexión con privilegios de postgres (DDL) + JWT del admin (auth.uid() resuelve). */
async function asAdminSuperuser<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: IDS.admin })]);
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

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
 * (un RAISE EXCEPTION no capturado aborta la transacción; sin un SAVEPOINT
 * acá, cualquier query posterior fallaría con "current transaction is
 * aborted" antes de poder verificar que no quedaron efectos parciales).
 */
async function callExpectingThrow(client: Client, sql: string, params: unknown[]): Promise<void> {
  await client.query('SAVEPOINT sp_call');
  try {
    await expect(client.query(sql, params as string[])).rejects.toThrow();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT sp_call');
  }
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'dia_tramite', '2027-02-01', '2027-02-01', 'pendiente')
  `, [REQ_PENDIENTE, IDS.employee1]);

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
    VALUES ($1, $2, 'dia_tramite', '2027-02-02', '2027-02-02', 'aprobado', $3, now())
  `, [REQ_YA_RESUELTA, IDS.employee1, IDS.admin]);

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'dia_tramite', '2027-02-03', '2027-02-03', 'pendiente')
  `, [REQ_PARA_RECHAZAR, IDS.employee1]);

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'dia_tramite', '2027-02-04', '2027-02-04', 'pendiente')
  `, [REQ_COLISION, IDS.employee2]);

  // Celda de calendario preexistente con OTRO estado_dia, para el test de colisión.
  await db.query(`
    INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
    VALUES ($1, '2027-02-04', 'trabajando', true)
  `, [IDS.employee2]);

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'dia_tramite', '2027-02-05', '2027-02-05', 'pendiente')
  `, [REQ_ATOMICIDAD_CALENDARIO, IDS.employee3]);

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'dia_tramite', '2027-02-06', '2027-02-06', 'pendiente')
  `, [REQ_ATOMICIDAD_AUDIT, IDS.employee3]);
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

// ─── Happy path ─────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('resolver_ausencia_request: happy path', () => {
  it('aprobar: pasa a aprobado, registra audit_log y crea rotation_assignments (periodo_fuera_trabajo/dia_tramite)', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_PENDIENTE]);

      const { rows: reqRows } = await c.query(
        `SELECT estado, reviewed_by, reviewed_at FROM ausencia_requests WHERE id = $1`,
        [REQ_PENDIENTE]
      );
      expect(reqRows[0].estado).toBe('aprobado');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);
      expect(reqRows[0].reviewed_at).not.toBeNull();

      const { rows: auditRows } = await c.query(
        `SELECT action, table_name, record_id, actor_id FROM audit_log WHERE record_id = $1`,
        [REQ_PENDIENTE]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('ausencia_approved');
      expect(auditRows[0].table_name).toBe('ausencia_requests');
      expect(auditRows[0].actor_id).toBe(IDS.admin);

      const { rows: calRows } = await c.query(
        `SELECT estado_dia, motivo_ausencia, es_estimado FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-01'`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(1);
      expect(calRows[0].estado_dia).toBe('periodo_fuera_trabajo');
      expect(calRows[0].motivo_ausencia).toBe('dia_tramite');
      expect(calRows[0].es_estimado).toBe(false);
    });
  });

  it('rechazar: pasa a rechazado con motivo, registra audit_log, no toca rotation_assignments', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(
        `SELECT public.resolver_ausencia_request($1, 'rechazar', $2)`,
        [REQ_PARA_RECHAZAR, 'No corresponde para esta fecha']
      );

      const { rows: reqRows } = await c.query(
        `SELECT estado, motivo_rechazo, reviewed_by FROM ausencia_requests WHERE id = $1`,
        [REQ_PARA_RECHAZAR]
      );
      expect(reqRows[0].estado).toBe('rechazado');
      expect(reqRows[0].motivo_rechazo).toBe('No corresponde para esta fecha');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);

      const { rows: auditRows } = await c.query(`SELECT action FROM audit_log WHERE record_id = $1`, [REQ_PARA_RECHAZAR]);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('ausencia_rejected');

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-03'`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(0);
    });
  });

  it('colisión de calendario: aprobar pisa una celda con otro estado_dia ya cargado, y queda auditado', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_COLISION]);

      const { rows: calRows } = await c.query(
        `SELECT estado_dia, motivo_ausencia FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-04'`,
        [IDS.employee2]
      );
      expect(calRows).toHaveLength(1);
      expect(calRows[0].estado_dia).toBe('periodo_fuera_trabajo');
      expect(calRows[0].motivo_ausencia).toBe('dia_tramite');

      const { rows: auditRows } = await c.query(`SELECT new_data FROM audit_log WHERE record_id = $1`, [REQ_COLISION]);
      expect(auditRows).toHaveLength(1);
      const calendarioPisado = auditRows[0].new_data.calendario_pisado;
      expect(calendarioPisado).toHaveLength(1);
      expect(calendarioPisado[0]).toMatchObject({ fecha: '2027-02-04', estado_dia_previo: 'trabajando' });
    });
  });
});

// ─── Guardas ────────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('resolver_ausencia_request: guardas', () => {
  it('empleado (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_PENDIENTE])
      ).rejects.toThrow();
    });
  });

  it('supervisor (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_PENDIENTE])
      ).rejects.toThrow();
    });
  });

  it('anon no puede ejecutar la función (GRANT lo bloquea antes de llegar a la guarda interna)', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_PENDIENTE])
      ).rejects.toThrow();
    });
  });

  it('solicitud ya resuelta → abort (no doble aprobación)', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_YA_RESUELTA])
      ).rejects.toThrow();
    });
  });

  it('rechazo sin motivo (NULL) → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'rechazar', NULL)`, [REQ_PENDIENTE])
      ).rejects.toThrow();
    });
  });

  it('rechazo con motivo en blanco (solo espacios) → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'rechazar', $2)`, [REQ_PENDIENTE, '   '])
      ).rejects.toThrow();
    });
  });

  it('acción inválida → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, $2, NULL)`, [REQ_PENDIENTE, 'archivar'])
      ).rejects.toThrow();
    });
  });

  it('solicitud inexistente → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [
          '00000000-0000-0000-0000-000000000000',
        ])
      ).rejects.toThrow();
    });
  });
});

// ─── Atomicidad ─────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('resolver_ausencia_request: atomicidad', () => {
  it('si falla el upsert de rotation_assignments, no persiste ni el UPDATE de estado ni el INSERT de audit_log', async () => {
    await asAdminSuperuser(async (c) => {
      await c.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_calendario CHECK (fecha <> '2027-02-05')
      `);

      await callExpectingThrow(
        c,
        `SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`,
        [REQ_ATOMICIDAD_CALENDARIO]
      );

      const { rows: reqRows } = await c.query(
        `SELECT estado FROM ausencia_requests WHERE id = $1`,
        [REQ_ATOMICIDAD_CALENDARIO]
      );
      expect(reqRows[0].estado).toBe('pendiente');

      const { rows: auditRows } = await c.query(`SELECT * FROM audit_log WHERE record_id = $1`, [REQ_ATOMICIDAD_CALENDARIO]);
      expect(auditRows).toHaveLength(0);

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-05'`,
        [IDS.employee3]
      );
      expect(calRows).toHaveLength(0);
      // El ROLLBACK final de asAdminSuperuser descarta también el ALTER TABLE (DDL transaccional).
    });
  });

  it('simétrico: si falla el INSERT a audit_log, tampoco persiste el UPDATE de ausencia_requests ni el upsert de rotation_assignments', async () => {
    await asAdminSuperuser(async (c) => {
      await c.query(`
        ALTER TABLE audit_log
        ADD CONSTRAINT test_force_fail_audit CHECK (action <> 'ausencia_approved')
      `);

      await callExpectingThrow(
        c,
        `SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`,
        [REQ_ATOMICIDAD_AUDIT]
      );

      const { rows: reqRows } = await c.query(
        `SELECT estado FROM ausencia_requests WHERE id = $1`,
        [REQ_ATOMICIDAD_AUDIT]
      );
      expect(reqRows[0].estado).toBe('pendiente');

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-06'`,
        [IDS.employee3]
      );
      expect(calRows).toHaveLength(0);
    });
  });
});
