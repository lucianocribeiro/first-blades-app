/**
 * Tests de integración — RPCs de procedimientos (FB-F5-02)
 * crear_procedimiento / actualizar_procedimiento / archivar_procedimiento
 *
 * Cubre, contra Postgres real:
 *  1. Happy path: crear (fila + audit_log 'procedimiento_creado', old_data
 *     NULL), actualizar (fila + audit_log 'procedimiento_actualizado' con
 *     old_data/new_data), archivar en ambas direcciones — vigente→archivado
 *     ('procedimiento_archivado') y archivado→vigente
 *     ('procedimiento_restaurado').
 *  2. Guardas: empleado, supervisor y anon no pueden invocar ninguna de las
 *     tres — ni dejan fila nueva en procedures ni entrada en audit_log.
 *  3. Atomicidad: si el INSERT a audit_log falla (forzado), la escritura en
 *     procedures tampoco persiste — todo o nada.
 *  4. CHECK procedures_contenido_presente: contenido_texto y file_path
 *     ambos NULL falla; contenido_texto en blanco (solo espacios) sin
 *     file_path también falla.
 *  5. log_audit() cerrada: un `authenticated` (incluso admin) que la invoca
 *     directo por RPC recibe error de permisos — regresión del hallazgo de
 *     FB-F5-01-INSPECT-REPORT.md (bloque C.3): antes de esta migración,
 *     cualquier authenticated podía escribir audit_log arbitrario vía REST.
 *
 * No re-testea la visibilidad RLS de `procedures` por rol (ver rls.test.ts,
 * describe 'RLS: procedures') ni el inventario de columnas/policies/firmas
 * (ver migration.test.ts) — las RPCs son SECURITY DEFINER y bypassean esa
 * RLS a propósito; lo que se prueba acá es su propia guarda interna, que es
 * el control de seguridad real de esta operación.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, asServiceRole, countRows, IDS, DB_URL } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// IDs fijos de procedimientos de prueba, uno por escenario.
const PROC_PARA_ACTUALIZAR = '11000000-0000-0000-0001-000000000001'; // vigente
const PROC_PARA_ARCHIVAR   = '11000000-0000-0000-0001-000000000002'; // vigente
const PROC_PARA_RESTAURAR  = '11000000-0000-0000-0001-000000000003'; // archivado

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

/** Igual que callExpectingThrow, pero además confirma que ni procedures ni audit_log crecieron. */
async function callExpectingThrowNoTrace(client: Client, sql: string, params: unknown[]): Promise<void> {
  const before = await countRows(client, 'procedures');
  const beforeAudit = await countRows(client, 'audit_log');
  await callExpectingThrow(client, sql, params);
  const after = await countRows(client, 'procedures');
  const afterAudit = await countRows(client, 'audit_log');
  expect(after).toBe(before);
  expect(afterAudit).toBe(beforeAudit);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await db.query(`
    INSERT INTO procedures (id, titulo, categoria, contenido_texto, created_by, updated_by, estado)
    VALUES ($1, 'Manual a actualizar', 'Seguridad', 'Contenido original', $2, $2, 'vigente')
  `, [PROC_PARA_ACTUALIZAR, IDS.admin]);

  await db.query(`
    INSERT INTO procedures (id, titulo, contenido_texto, created_by, updated_by, estado)
    VALUES ($1, 'Manual a archivar', 'Contenido vigente', $2, $2, 'vigente')
  `, [PROC_PARA_ARCHIVAR, IDS.admin]);

  await db.query(`
    INSERT INTO procedures (id, titulo, contenido_texto, created_by, updated_by, estado)
    VALUES ($1, 'Manual a restaurar', 'Contenido archivado', $2, $2, 'archivado')
  `, [PROC_PARA_RESTAURAR, IDS.admin]);
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

describe.skipIf(!dbAvailable)('RPCs de procedimientos: happy path', () => {
  it('crear_procedimiento: crea la fila (estado vigente) y registra audit_log con old_data NULL', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: idRows } = await c.query(
        `SELECT public.crear_procedimiento($1, $2, $3, $4) AS id`,
        ['Manual Nuevo', 'Seguridad', 'Contenido del manual', null]
      );
      const newId = idRows[0].id;
      expect(newId).toBeDefined();

      const { rows: procRows } = await c.query(
        `SELECT titulo, categoria, contenido_texto, file_path, estado, created_by, updated_by
         FROM procedures WHERE id = $1`,
        [newId]
      );
      expect(procRows).toHaveLength(1);
      expect(procRows[0]).toMatchObject({
        titulo: 'Manual Nuevo',
        categoria: 'Seguridad',
        contenido_texto: 'Contenido del manual',
        file_path: null,
        estado: 'vigente',
        created_by: IDS.admin,
        updated_by: IDS.admin,
      });

      const { rows: auditRows } = await c.query(
        `SELECT action, table_name, record_id, actor_id, old_data, new_data
         FROM audit_log WHERE record_id = $1`,
        [newId]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('procedimiento_creado');
      expect(auditRows[0].table_name).toBe('procedures');
      expect(auditRows[0].actor_id).toBe(IDS.admin);
      expect(auditRows[0].old_data).toBeNull();
      expect(auditRows[0].new_data).toMatchObject({ titulo: 'Manual Nuevo', estado: 'vigente' });
    });
  });

  it('actualizar_procedimiento: actualiza la fila y registra audit_log con old_data/new_data', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(
        `SELECT public.actualizar_procedimiento($1, $2, $3, $4, $5)`,
        [PROC_PARA_ACTUALIZAR, 'Manual Actualizado', 'Operaciones', 'Contenido nuevo', null]
      );

      const { rows: procRows } = await c.query(
        `SELECT titulo, categoria, contenido_texto, updated_by FROM procedures WHERE id = $1`,
        [PROC_PARA_ACTUALIZAR]
      );
      expect(procRows[0]).toMatchObject({
        titulo: 'Manual Actualizado',
        categoria: 'Operaciones',
        contenido_texto: 'Contenido nuevo',
        updated_by: IDS.admin,
      });

      const { rows: auditRows } = await c.query(
        `SELECT action, old_data, new_data FROM audit_log WHERE record_id = $1`,
        [PROC_PARA_ACTUALIZAR]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('procedimiento_actualizado');
      expect(auditRows[0].old_data).toMatchObject({ titulo: 'Manual a actualizar', categoria: 'Seguridad' });
      expect(auditRows[0].new_data).toMatchObject({ titulo: 'Manual Actualizado', categoria: 'Operaciones' });
    });
  });

  it("archivar_procedimiento: vigente → archivado registra audit_log 'procedimiento_archivado'", async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.archivar_procedimiento($1, 'archivado')`, [PROC_PARA_ARCHIVAR]);

      const { rows: procRows } = await c.query(`SELECT estado FROM procedures WHERE id = $1`, [PROC_PARA_ARCHIVAR]);
      expect(procRows[0].estado).toBe('archivado');

      const { rows: auditRows } = await c.query(
        `SELECT action, old_data, new_data FROM audit_log WHERE record_id = $1`,
        [PROC_PARA_ARCHIVAR]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('procedimiento_archivado');
      expect(auditRows[0].old_data).toEqual({ estado: 'vigente' });
      expect(auditRows[0].new_data).toEqual({ estado: 'archivado' });
    });
  });

  it("archivar_procedimiento: archivado → vigente (restaurar) registra audit_log 'procedimiento_restaurado'", async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.archivar_procedimiento($1, 'vigente')`, [PROC_PARA_RESTAURAR]);

      const { rows: procRows } = await c.query(`SELECT estado FROM procedures WHERE id = $1`, [PROC_PARA_RESTAURAR]);
      expect(procRows[0].estado).toBe('vigente');

      const { rows: auditRows } = await c.query(
        `SELECT action, old_data, new_data FROM audit_log WHERE record_id = $1`,
        [PROC_PARA_RESTAURAR]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('procedimiento_restaurado');
      expect(auditRows[0].old_data).toEqual({ estado: 'archivado' });
      expect(auditRows[0].new_data).toEqual({ estado: 'vigente' });
    });
  });
});

// ─── Guardas ────────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('RPCs de procedimientos: guardas de admin', () => {
  const nonAdminRoles = [
    ['empleado', IDS.employee1],
    ['supervisor', IDS.supervisor],
  ] as const;

  for (const [roleLabel, roleId] of nonAdminRoles) {
    it(`${roleLabel} (no-admin) no puede crear_procedimiento — sin rastro en procedures ni audit_log`, async () => {
      await asUser(roleId, async (c) => {
        await callExpectingThrowNoTrace(
          c,
          `SELECT public.crear_procedimiento($1, $2, $3, $4)`,
          ['Hack', null, 'Contenido hack', null]
        );
      });
    });

    it(`${roleLabel} (no-admin) no puede actualizar_procedimiento — sin rastro en audit_log`, async () => {
      await asUser(roleId, async (c) => {
        await callExpectingThrowNoTrace(
          c,
          `SELECT public.actualizar_procedimiento($1, $2, $3, $4, $5)`,
          [PROC_PARA_ACTUALIZAR, 'Hack', null, 'Contenido hack', null]
        );
      });
    });

    it(`${roleLabel} (no-admin) no puede archivar_procedimiento — sin rastro en audit_log`, async () => {
      await asUser(roleId, async (c) => {
        await callExpectingThrowNoTrace(
          c,
          `SELECT public.archivar_procedimiento($1, 'archivado')`,
          [PROC_PARA_ARCHIVAR]
        );
      });
    });
  }

  it('anon no puede ejecutar ninguna de las tres RPCs (GRANT lo bloquea antes de la guarda interna)', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.crear_procedimiento('Hack', NULL, 'x', NULL)`)
      ).rejects.toThrow();
      await expect(
        c.query(`SELECT public.actualizar_procedimiento($1, 'Hack', NULL, 'x', NULL)`, [PROC_PARA_ACTUALIZAR])
      ).rejects.toThrow();
      await expect(
        c.query(`SELECT public.archivar_procedimiento($1, 'archivado')`, [PROC_PARA_ARCHIVAR])
      ).rejects.toThrow();
    });
  });

  it('actualizar_procedimiento sobre un id inexistente → abort (incluso como admin)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.actualizar_procedimiento($1, 'x', NULL, 'y', NULL)`,
        ['00000000-0000-0000-0000-000000000000']
      );
    });
  });

  it('archivar_procedimiento sobre un id inexistente → abort (incluso como admin)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.archivar_procedimiento($1, 'archivado')`,
        ['00000000-0000-0000-0000-000000000000']
      );
    });
  });
});

// ─── Atomicidad ─────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('RPCs de procedimientos: atomicidad', () => {
  it('crear_procedimiento: si falla el INSERT a audit_log, tampoco persiste la fila en procedures', async () => {
    await asAdminSuperuser(async (c) => {
      await c.query(`
        ALTER TABLE audit_log
        ADD CONSTRAINT test_force_fail_procedimiento_audit CHECK (action <> 'procedimiento_creado')
      `);

      await callExpectingThrow(
        c,
        `SELECT public.crear_procedimiento($1, $2, $3, $4)`,
        ['Atomicidad Crear', null, 'Contenido atomicidad', null]
      );

      const { rows } = await c.query(`SELECT * FROM procedures WHERE titulo = 'Atomicidad Crear'`);
      expect(rows).toHaveLength(0);

      const { rows: auditRows } = await c.query(
        `SELECT * FROM audit_log WHERE action = 'procedimiento_creado' AND new_data->>'titulo' = 'Atomicidad Crear'`
      );
      expect(auditRows).toHaveLength(0);
      // El ROLLBACK final de asAdminSuperuser descarta también el ALTER TABLE (DDL transaccional).
    });
  });

  it('archivar_procedimiento: si falla el INSERT a audit_log, el estado NO cambia', async () => {
    await asAdminSuperuser(async (c) => {
      await c.query(`
        ALTER TABLE audit_log
        ADD CONSTRAINT test_force_fail_procedimiento_archivar CHECK (action <> 'procedimiento_archivado')
      `);

      await callExpectingThrow(
        c,
        `SELECT public.archivar_procedimiento($1, 'archivado')`,
        [PROC_PARA_ARCHIVAR]
      );

      const { rows } = await c.query(`SELECT estado FROM procedures WHERE id = $1`, [PROC_PARA_ARCHIVAR]);
      expect(rows[0].estado).toBe('vigente');
    });
  });
});

// ─── CHECK: procedures_contenido_presente ────────────────────────

describe.skipIf(!dbAvailable)('procedures: CHECK procedures_contenido_presente (FB-F5-02)', () => {
  it('rechaza un INSERT con contenido_texto y file_path ambos NULL', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO procedures (titulo, created_by) VALUES ('Sin contenido', $1)`,
          [IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('rechaza un INSERT con contenido_texto en blanco (solo espacios) y sin file_path', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO procedures (titulo, contenido_texto, created_by) VALUES ('Blanco', '   ', $1)`,
          [IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('acepta un INSERT con solo contenido_texto', async () => {
    await asServiceRole(async (client) => {
      const res = await client.query(
        `INSERT INTO procedures (titulo, contenido_texto, created_by) VALUES ('Con texto', 'Contenido real', $1) RETURNING id`,
        [IDS.admin]
      );
      expect(res.rows).toHaveLength(1);
    });
  });

  it('acepta un INSERT con solo file_path', async () => {
    await asServiceRole(async (client) => {
      const res = await client.query(
        `INSERT INTO procedures (titulo, file_path, created_by) VALUES ('Con archivo', 'proc-id/manual.pdf', $1) RETURNING id`,
        [IDS.admin]
      );
      expect(res.rows).toHaveLength(1);
    });
  });
});

// ─── log_audit() cerrada ──────────────────────────────────────────

describe.skipIf(!dbAvailable)('log_audit(): cerrada a authenticated/anon (FB-F5-02)', () => {
  it('un authenticated (admin) que invoca log_audit directo por RPC recibe error de permisos', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.log_audit('hack', 'procedures', gen_random_uuid())`)
      ).rejects.toThrow();
    });
  });

  it('anon que invoca log_audit directo por RPC recibe error de permisos', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.log_audit('hack', 'procedures', gen_random_uuid())`)
      ).rejects.toThrow();
    });
  });
});
