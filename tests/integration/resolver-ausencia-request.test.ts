/**
 * Tests de integración — función resolver_ausencia_request (FB-F3-17, FB-F4-03)
 *
 * Cubre, contra Postgres real:
 *  1. Happy path: aprobar (estado, audit_log, rotation_assignments) y
 *     rechazar (estado + motivo_rechazo, audit_log, sin tocar el calendario).
 *     El caso de aprobar es también la prueba de "día único sin regresión"
 *     (FB-F4-03 §5): fecha_inicio = fecha_fin, 1 sola fila esperada.
 *  2. Guardas: no-admin (empleado/supervisor), anon (grant), solicitud ya
 *     resuelta, rechazo sin motivo (o solo blanco), acción inválida,
 *     solicitud inexistente. Sin cambios en FB-F4-03 — 0015 no toca ninguna
 *     guarda; siguen corriendo tal cual contra la función reescrita.
 *  3. Colisión de calendario: aprobar pisa una celda con otro estado_dia ya
 *     cargado, y la queda auditada en el mismo audit_log.
 *  4. Atomicidad: si falla el upsert de rotation_assignments o el INSERT de
 *     audit_log, ausencia_requests NO queda actualizada — todo o nada.
 *  5. FB-F4-03: expansión de rango per-día (N días, no solo 1) para
 *     cualquier motivo — vacaciones, licencia_medica, otros (con
 *     motivo_otros_texto) — con sobrescritura auditada y atomicidad sobre
 *     un rango multi-día (ninguna fila del rango persiste si falla a mitad
 *     de camino, ni siquiera los días que el loop ya había insertado antes
 *     del que falla).
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

// FB-F4-03: expansión de rango + todos los motivos
const REQ_RANGO_VACACIONES      = 'd1000000-0000-0000-0001-000000000007'; // employee1, 2027-03-01..05 (5 días), vacaciones
const REQ_RANGO_SOBRESCRITURA   = 'd1000000-0000-0000-0001-000000000008'; // employee2, 2027-03-10..12 (3 días), licencia_medica
const REQ_OTROS                 = 'd1000000-0000-0000-0001-000000000009'; // employee1, 2027-03-15..16 (2 días), otros + motivo_otros_texto
const REQ_ATOMICIDAD_RANGO      = 'd1000000-0000-0000-0001-00000000000a'; // employee3, 2027-03-20..24 (5 días), vacaciones

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

  // FB-F4-03: rango de 5 días, motivo vacaciones (no dia_tramite).
  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'vacaciones', '2027-03-01', '2027-03-05', 'pendiente')
  `, [REQ_RANGO_VACACIONES, IDS.employee1]);

  // FB-F4-03: rango de 3 días, motivo licencia_medica, con un día del medio
  // (03-11) ya cargado con otro estado_dia, para el test de sobrescritura.
  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'licencia_medica', '2027-03-10', '2027-03-12', 'pendiente')
  `, [REQ_RANGO_SOBRESCRITURA, IDS.employee2]);
  await db.query(`
    INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
    VALUES ($1, '2027-03-11', 'trabajando', true)
  `, [IDS.employee2]);

  // FB-F4-03: motivo 'otros' con motivo_otros_texto, rango de 2 días.
  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, motivo_otros_texto, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'otros', 'Trámite médico personal', '2027-03-15', '2027-03-16', 'pendiente')
  `, [REQ_OTROS, IDS.employee1]);

  // FB-F4-03: rango de 5 días para el test de atomicidad de rango.
  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'vacaciones', '2027-03-20', '2027-03-24', 'pendiente')
  `, [REQ_ATOMICIDAD_RANGO, IDS.employee3]);
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

      // FB-F4-20: la transición de la request sigue siendo una única fila
      // (record_id=REQ_PENDIENTE) — el detalle del día pisado ya no va acá,
      // vive en su propia fila de audit_log (table_name='rotation_assignments').
      const { rows: auditRows } = await c.query(
        `SELECT action, table_name, record_id, actor_id, new_data FROM audit_log WHERE record_id = $1`,
        [REQ_PENDIENTE]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('ausencia_approved');
      expect(auditRows[0].table_name).toBe('ausencia_requests');
      expect(auditRows[0].actor_id).toBe(IDS.admin);
      expect(auditRows[0].new_data).toEqual({ estado: 'aprobado' });

      const { rows: calRows } = await c.query(
        `SELECT id, estado_dia, motivo_ausencia, es_estimado FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-01'`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(1);
      expect(calRows[0].estado_dia).toBe('periodo_fuera_trabajo');
      expect(calRows[0].motivo_ausencia).toBe('dia_tramite');
      expect(calRows[0].es_estimado).toBe(false);

      // FB-F4-20: 1 fila de audit_log por día pisado (acá, el único día del
      // rango), table_name='rotation_assignments', record_id=id real de la
      // fila de calendario — igual convención que pasaje.
      const { rows: calAuditRows } = await c.query(
        `SELECT table_name, old_data, new_data FROM audit_log
         WHERE action = 'ausencia_calendario_sobrescrito' AND record_id = $1`,
        [calRows[0].id]
      );
      expect(calAuditRows).toHaveLength(1);
      expect(calAuditRows[0].table_name).toBe('rotation_assignments');
      expect(calAuditRows[0].old_data).toBeNull();
      expect(calAuditRows[0].new_data).toMatchObject({ fecha: '2027-02-01', estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'dia_tramite' });
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

      // FB-F4-20: la transición ya no lleva calendario_pisado embebido.
      const { rows: transitionRows } = await c.query(`SELECT new_data FROM audit_log WHERE record_id = $1`, [REQ_COLISION]);
      expect(transitionRows).toHaveLength(1);
      expect(transitionRows[0].new_data).toEqual({ estado: 'aprobado' });

      // El detalle de la colisión vive en la fila por-día
      // (table_name='rotation_assignments'), con old_data = la celda previa.
      const { rows: calAuditRows } = await c.query(
        `SELECT table_name, old_data FROM audit_log
         WHERE action = 'ausencia_calendario_sobrescrito'
           AND record_id IN (SELECT id FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-02-04')`,
        [IDS.employee2]
      );
      expect(calAuditRows).toHaveLength(1);
      expect(calAuditRows[0].table_name).toBe('rotation_assignments');
      expect(calAuditRows[0].old_data).toMatchObject({ estado_dia: 'trabajando' });
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

// ─── FB-F4-03: expansión de rango per-día + todos los motivos ────

describe.skipIf(!dbAvailable)('resolver_ausencia_request: expansión de rango per-día (FB-F4-03)', () => {
  it('aprobar un rango de 5 días (vacaciones): escribe 5 filas periodo_fuera_trabajo/vacaciones, es_estimado=false, una por día', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_RANGO_VACACIONES]);

      const { rows: reqRows } = await c.query(`SELECT estado FROM ausencia_requests WHERE id = $1`, [REQ_RANGO_VACACIONES]);
      expect(reqRows[0].estado).toBe('aprobado');

      const { rows: calRows } = await c.query(
        `SELECT fecha::text AS fecha, estado_dia, motivo_ausencia, es_estimado FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-03-01' AND '2027-03-05' ORDER BY fecha`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(5);
      // fecha::text evita que el driver de pg parsee `date` a un JS Date
      // (que interpreta a medianoche LOCAL) y corra el string por timezone.
      const fechas = calRows.map((r) => r.fecha);
      expect(fechas).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05']);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('periodo_fuera_trabajo');
        expect(row.motivo_ausencia).toBe('vacaciones');
        expect(row.es_estimado).toBe(false);
      }

      const { rows: auditRows } = await c.query(`SELECT action, new_data FROM audit_log WHERE record_id = $1`, [REQ_RANGO_VACACIONES]);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('ausencia_approved');
      expect(auditRows[0].new_data).toEqual({ estado: 'aprobado' });

      // FB-F4-20: 1 fila de audit_log por día del rango (5), no una sola
      // agrupada — misma convención por-día que resolver_pasaje_request.
      const { rows: calAuditRows } = await c.query(
        `SELECT new_data FROM audit_log
         WHERE action = 'ausencia_calendario_sobrescrito'
           AND record_id IN (
             SELECT id FROM rotation_assignments WHERE user_id = $1 AND fecha BETWEEN '2027-03-01' AND '2027-03-05'
           )`,
        [IDS.employee1]
      );
      expect(calAuditRows).toHaveLength(5);
      const fechasAuditadas = calAuditRows.map((r) => r.new_data.fecha).sort();
      expect(fechasAuditadas).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05']);
    });
  });

  it('sobrescritura dentro de un rango: un día del medio con fila previa (trabajando) queda periodo_fuera_trabajo, y el old_data queda en audit_log', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_RANGO_SOBRESCRITURA]);

      const { rows: calRows } = await c.query(
        `SELECT fecha, estado_dia, motivo_ausencia FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-03-10' AND '2027-03-12' ORDER BY fecha`,
        [IDS.employee2]
      );
      expect(calRows).toHaveLength(3);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('periodo_fuera_trabajo');
        expect(row.motivo_ausencia).toBe('licencia_medica');
      }

      const { rows: transitionRows } = await c.query(`SELECT new_data FROM audit_log WHERE record_id = $1`, [REQ_RANGO_SOBRESCRITURA]);
      expect(transitionRows).toHaveLength(1);
      expect(transitionRows[0].new_data).toEqual({ estado: 'aprobado' });

      // FB-F4-20: 1 fila por-día (3), old_data refleja la celda previa
      // exacta cuando existía (03-11) y NULL cuando el día estaba libre
      // (03-10, 03-12) — igual que el molde de pasaje.
      const { rows: calAuditRows } = await c.query(
        `SELECT old_data, new_data FROM audit_log
         WHERE action = 'ausencia_calendario_sobrescrito'
           AND record_id IN (
             SELECT id FROM rotation_assignments WHERE user_id = $1 AND fecha BETWEEN '2027-03-10' AND '2027-03-12'
           )`,
        [IDS.employee2]
      );
      expect(calAuditRows).toHaveLength(3);
      const porFecha = Object.fromEntries(calAuditRows.map((r) => [r.new_data.fecha, r]));
      expect(porFecha['2027-03-10'].old_data).toBeNull();
      expect(porFecha['2027-03-11'].old_data).toMatchObject({ estado_dia: 'trabajando' });
      expect(porFecha['2027-03-12'].old_data).toBeNull();
    });
  });

  it("motivo 'otros': aprobar propaga motivo_otros_texto a cada fila del calendario del rango", async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [REQ_OTROS]);

      const { rows: calRows } = await c.query(
        `SELECT fecha, estado_dia, motivo_ausencia, motivo_otros_texto FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-03-15' AND '2027-03-16' ORDER BY fecha`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(2);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('periodo_fuera_trabajo');
        expect(row.motivo_ausencia).toBe('otros');
        expect(row.motivo_otros_texto).toBe('Trámite médico personal');
      }
    });
  });

  it('atomicidad de rango: un fallo a mitad del rango revierte TODAS las filas del rango, incluidas las que el loop ya había insertado antes de la que falla', async () => {
    // Setup DDL privilegiado (fixture): agrega temporalmente un CHECK que
    // fuerza el fallo a mitad de rango. ALTER TABLE requiere el rol
    // propietario de la tabla (no authenticated), así que corre en una
    // conexión aparte y se COMMITea de una — fuera de la invocación
    // afirmada de abajo — para que sea visible en la conexión separada de
    // asUser(). Como queda committeado (no dentro de una transacción que
    // se revierte), se limpia explícitamente en el finally.
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    try {
      // El rango es 2027-03-20..24; el loop inserta en orden ascendente, así
      // que al forzar el fallo en el día del medio (03-22), 03-20 y 03-21 ya
      // se habrían insertado en la MISMA transacción antes de llegar al
      // error — la prueba real de atomicidad es que ESOS también desaparecen.
      await setupClient.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_rango CHECK (fecha <> '2027-03-22')
      `);

      // Paso afirmado: corre bajo asUser(IDS.admin) — rol authenticated +
      // claims de admin, el camino de ejecución real del RPC — no como
      // postgres/superusuario (FB-F4-AUD-02).
      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(
          c,
          `SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`,
          [REQ_ATOMICIDAD_RANGO]
        );

        const { rows: reqRows } = await c.query(`SELECT estado FROM ausencia_requests WHERE id = $1`, [REQ_ATOMICIDAD_RANGO]);
        expect(reqRows[0].estado).toBe('pendiente');

        const { rows: auditRows } = await c.query(`SELECT * FROM audit_log WHERE record_id = $1`, [REQ_ATOMICIDAD_RANGO]);
        expect(auditRows).toHaveLength(0);

        const { rows: calRows } = await c.query(
          `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha BETWEEN '2027-03-20' AND '2027-03-24'`,
          [IDS.employee3]
        );
        expect(calRows).toHaveLength(0);
      });
    } finally {
      await setupClient.query(`ALTER TABLE rotation_assignments DROP CONSTRAINT IF EXISTS test_force_fail_rango`);
      await setupClient.end();
    }
  });
});
