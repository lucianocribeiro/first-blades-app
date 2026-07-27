/**
 * Tests de integración — función resolver_pasaje_request (FB-F4-07)
 *
 * Cubre, contra Postgres real:
 *  1. Happy path: aprobar días sueltos (no un rango contiguo) → N filas
 *     'en_viaje' en el calendario del empleado_id, es_estimado=false,
 *     motivo_ausencia=NULL; estado→aprobado; audit_log registra la
 *     transición. Rechazar: estado→rechazado + motivo, audit_log, sin tocar
 *     el calendario.
 *  2. Destino correcto: cuando solicitante_id ≠ empleado_id (supervisor pide
 *     para su equipo), las filas se escriben en el calendario del
 *     empleado_id, no del solicitante.
 *  3. Sobrescritura: un día con 'trabajando' y otro con 'periodo_fuera_trabajo'
 *     + motivo quedan 'en_viaje' con motivo_ausencia limpiado; old_data en
 *     audit_log; el CHECK rotation_assignments_motivo_requerido no se viola
 *     (en_viaje no exige motivo).
 *  4. Atomicidad: fallo forzado a mitad de un array de días sueltos revierte
 *     TODAS las filas de esa invocación (incluidas las que el loop ya había
 *     insertado antes de la que falla) y la request no cambia de estado.
 *     Mismo patrón simétrico para un fallo en el INSERT de audit_log.
 *  5. Guardas de §6.1: no-admin (empleado/supervisor), anon (GRANT), ya
 *     resuelta, rechazo sin motivo / motivo en blanco, acción inválida,
 *     solicitud inexistente.
 *  6. Guarda propia (no en el molde de ausencia): aprobar una fila con
 *     dias_viaje NULL (legacy, previa a FB-F4-08) da un error amigable en
 *     vez del error crudo de "FOREACH expression must not be null".
 *  7. CHECK de columna pasaje_requests_dias_viaje_no_vacio: dias_viaje='{}'
 *     rechazado, NULL permitido (fila legacy) — probado directo por INSERT,
 *     sin pasar por la RPC.
 *
 * No re-testea las policies de RLS de pasaje_requests/rotation_assignments/
 * audit_log en sí (ver rls-policies.test.ts) — la función es SECURITY
 * DEFINER y bypassea esa RLS a propósito; lo que se prueba acá es su propia
 * guarda interna, que es el control de seguridad real de esta operación.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, asServiceRole, IDS, DB_URL } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// IDs fijos de solicitudes de prueba, una por escenario.
const REQ_DIAS_SUELTOS       = 'e2000000-0000-0000-0002-000000000001'; // employee1, días 04-01/04-03/04-05 (no contiguos) — happy path aprobar
const REQ_YA_RESUELTA        = 'e2000000-0000-0000-0002-000000000002'; // employee1, ya aprobada
const REQ_PARA_RECHAZAR      = 'e2000000-0000-0000-0002-000000000003'; // employee1 — happy path rechazar
const REQ_DESTINO_SUPERVISOR = 'e2000000-0000-0000-0002-000000000004'; // solicitante=supervisor, empleado=employee2
const REQ_SOBRESCRITURA      = 'e2000000-0000-0000-0002-000000000005'; // employee2, 3 días con colisiones
const REQ_ATOMICIDAD_CAL     = 'e2000000-0000-0000-0002-000000000006'; // employee3 — falla el upsert de rotation_assignments
const REQ_ATOMICIDAD_AUDIT   = 'e2000000-0000-0000-0002-000000000007'; // employee3 — falla el INSERT de audit_log
const REQ_ATOMICIDAD_MULTI   = 'e2000000-0000-0000-0002-000000000008'; // employee3, 3 días sueltos, falla el del medio
const REQ_SIN_DIAS            = 'e2000000-0000-0000-0002-000000000009'; // employee1, dias_viaje NULL (fila legacy)

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

/** INSERT base de pasaje_requests: fecha_viaje (legacy, NOT NULL) toma el primer día de dias_viaje. */
async function insertPasaje(
  client: Client,
  opts: {
    id: string;
    solicitanteId: string;
    empleadoId: string;
    diasViaje: string[] | null;
    estado?: string;
    reviewedBy?: string;
  }
): Promise<void> {
  const fechaViaje = opts.diasViaje?.[0] ?? '2027-04-01';
  // reviewedAt se calcula en JS (no en un CASE sobre $7 en SQL): reusar el
  // mismo parámetro posicional en dos contextos distintos (valor directo de
  // reviewed_by y condición de un CASE) le impide a Postgres inferir su
  // tipo ("could not determine data type of parameter $7") — cada
  // parámetro queda mapeado 1:1 a una sola columna con tipo inequívoco.
  const reviewedAt = opts.reviewedBy ? new Date() : null;
  await client.query(
    `INSERT INTO pasaje_requests
       (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, estado, reviewed_by, reviewed_at)
     VALUES
       ($1, $2, $3, 'traslado_proyectos', $4, 'Base', 'Sitio', $5::date[], $6, $7, $8)`,
    [
      opts.id,
      opts.solicitanteId,
      opts.empleadoId,
      fechaViaje,
      opts.diasViaje,
      opts.estado ?? 'pendiente',
      opts.reviewedBy ?? null,
      reviewedAt,
    ]
  );
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await insertPasaje(db, {
    id: REQ_DIAS_SUELTOS,
    solicitanteId: IDS.employee1,
    empleadoId: IDS.employee1,
    diasViaje: ['2027-04-01', '2027-04-03', '2027-04-05'],
  });

  await insertPasaje(db, {
    id: REQ_YA_RESUELTA,
    solicitanteId: IDS.employee1,
    empleadoId: IDS.employee1,
    diasViaje: ['2027-04-02'],
    estado: 'aprobado',
    reviewedBy: IDS.admin,
  });

  await insertPasaje(db, {
    id: REQ_PARA_RECHAZAR,
    solicitanteId: IDS.employee1,
    empleadoId: IDS.employee1,
    diasViaje: ['2027-04-06'],
  });

  await insertPasaje(db, {
    id: REQ_DESTINO_SUPERVISOR,
    solicitanteId: IDS.supervisor,
    empleadoId: IDS.employee2,
    diasViaje: ['2027-04-15', '2027-04-16'],
  });

  await insertPasaje(db, {
    id: REQ_SOBRESCRITURA,
    solicitanteId: IDS.employee2,
    empleadoId: IDS.employee2,
    diasViaje: ['2027-04-20', '2027-04-21', '2027-04-22'],
  });
  // Colisiones preexistentes para el test de sobrescritura: 04-20 sin
  // motivo (trabajando), 04-21 con motivo (periodo_fuera_trabajo), 04-22
  // libre (sin fila) — para confirmar que solo se reporta lo que realmente
  // pisa.
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
     VALUES ($1, '2027-04-20', 'trabajando', true)`,
    [IDS.employee2]
  );
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado)
     VALUES ($1, '2027-04-21', 'periodo_fuera_trabajo', 'vacaciones', false)`,
    [IDS.employee2]
  );

  await insertPasaje(db, {
    id: REQ_ATOMICIDAD_CAL,
    solicitanteId: IDS.employee3,
    empleadoId: IDS.employee3,
    diasViaje: ['2027-04-25'],
  });

  await insertPasaje(db, {
    id: REQ_ATOMICIDAD_AUDIT,
    solicitanteId: IDS.employee3,
    empleadoId: IDS.employee3,
    diasViaje: ['2027-04-26'],
  });

  await insertPasaje(db, {
    id: REQ_ATOMICIDAD_MULTI,
    solicitanteId: IDS.employee3,
    empleadoId: IDS.employee3,
    diasViaje: ['2027-04-27', '2027-04-28', '2027-04-29'],
  });

  await insertPasaje(db, {
    id: REQ_SIN_DIAS,
    solicitanteId: IDS.employee1,
    empleadoId: IDS.employee1,
    diasViaje: null,
  });
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

describe.skipIf(!dbAvailable)('resolver_pasaje_request: happy path', () => {
  it('aprobar días sueltos (no contiguos): 3 filas en_viaje en el calendario del empleado, es_estimado=false, motivo_ausencia=NULL', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_DIAS_SUELTOS]);

      const { rows: reqRows } = await c.query(
        `SELECT estado, reviewed_by, reviewed_at FROM pasaje_requests WHERE id = $1`,
        [REQ_DIAS_SUELTOS]
      );
      expect(reqRows[0].estado).toBe('aprobado');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);
      expect(reqRows[0].reviewed_at).not.toBeNull();

      const { rows: auditRows } = await c.query(
        `SELECT action, table_name, record_id, actor_id FROM audit_log WHERE record_id = $1`,
        [REQ_DIAS_SUELTOS]
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('pasaje_approved');
      expect(auditRows[0].table_name).toBe('pasaje_requests');
      expect(auditRows[0].actor_id).toBe(IDS.admin);

      const { rows: calRows } = await c.query(
        `SELECT fecha::text AS fecha, estado_dia, motivo_ausencia, es_estimado FROM rotation_assignments
         WHERE user_id = $1 AND fecha = ANY ($2::date[]) ORDER BY fecha`,
        [IDS.employee1, ['2027-04-01', '2027-04-03', '2027-04-05']]
      );
      expect(calRows).toHaveLength(3);
      expect(calRows.map((r) => r.fecha)).toEqual(['2027-04-01', '2027-04-03', '2027-04-05']);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('en_viaje');
        expect(row.motivo_ausencia).toBeNull();
        expect(row.es_estimado).toBe(false);
      }

      // El día 04-02 (entre el 1° y el 3° día del array) no está en
      // dias_viaje — confirma que son días discretos, no un rango expandido.
      const { rows: gapRow } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-04-02'`,
        [IDS.employee1]
      );
      expect(gapRow).toHaveLength(0);
    });
  });

  it('rechazar: pasa a rechazado con motivo, registra audit_log, no toca rotation_assignments', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(
        `SELECT public.resolver_pasaje_request($1, 'rechazar', $2)`,
        [REQ_PARA_RECHAZAR, 'No hay presupuesto para este viaje']
      );

      const { rows: reqRows } = await c.query(
        `SELECT estado, motivo_rechazo, reviewed_by FROM pasaje_requests WHERE id = $1`,
        [REQ_PARA_RECHAZAR]
      );
      expect(reqRows[0].estado).toBe('rechazado');
      expect(reqRows[0].motivo_rechazo).toBe('No hay presupuesto para este viaje');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);

      const { rows: auditRows } = await c.query(`SELECT action FROM audit_log WHERE record_id = $1`, [REQ_PARA_RECHAZAR]);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe('pasaje_rejected');

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-04-06'`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(0);
    });
  });
});

// ─── Destino correcto (empleado_id, no solicitante_id) ───────────

describe.skipIf(!dbAvailable)('resolver_pasaje_request: destino correcto (FB-F4-07)', () => {
  it('supervisor pide pasaje para su equipo: las filas se escriben en el calendario del empleado_id, no del solicitante', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_DESTINO_SUPERVISOR]);

      const { rows: empleadoRows } = await c.query(
        `SELECT fecha::text AS fecha, estado_dia FROM rotation_assignments
         WHERE user_id = $1 AND fecha = ANY ($2::date[]) ORDER BY fecha`,
        [IDS.employee2, ['2027-04-15', '2027-04-16']]
      );
      expect(empleadoRows).toHaveLength(2);
      for (const row of empleadoRows) expect(row.estado_dia).toBe('en_viaje');

      const { rows: solicitanteRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = ANY ($2::date[])`,
        [IDS.supervisor, ['2027-04-15', '2027-04-16']]
      );
      expect(solicitanteRows).toHaveLength(0);
    });
  });
});

// ─── Sobrescritura ────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('resolver_pasaje_request: sobrescritura (FB-F4-07)', () => {
  it('un día "trabajando" y otro "periodo_fuera_trabajo"+motivo quedan en_viaje con motivo limpiado; old_data queda en audit_log', async () => {
    await asUser(IDS.admin, async (c) => {
      await c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_SOBRESCRITURA]);

      const { rows: calRows } = await c.query(
        `SELECT fecha::text AS fecha, estado_dia, motivo_ausencia, motivo_otros_texto FROM rotation_assignments
         WHERE user_id = $1 AND fecha = ANY ($2::date[]) ORDER BY fecha`,
        [IDS.employee2, ['2027-04-20', '2027-04-21', '2027-04-22']]
      );
      expect(calRows).toHaveLength(3);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('en_viaje');
        // El CHECK rotation_assignments_motivo_requerido solo exige motivo
        // para periodo_fuera_trabajo — que estas 3 filas existan con
        // motivo_ausencia NULL y estado_dia='en_viaje' confirma que el
        // CHECK no se violó (si se violara, el UPDATE habría abortado toda
        // la transacción y este SELECT no encontraría nada).
        expect(row.motivo_ausencia).toBeNull();
        expect(row.motivo_otros_texto).toBeNull();
      }

      const { rows: auditRows } = await c.query(`SELECT new_data FROM audit_log WHERE record_id = $1`, [REQ_SOBRESCRITURA]);
      expect(auditRows).toHaveLength(1);
      const calendarioPisado = auditRows[0].new_data.calendario_pisado;
      // Solo 04-20 y 04-21 tenían fila previa; 04-22 estaba libre.
      expect(calendarioPisado).toHaveLength(2);
      const porFecha = Object.fromEntries(calendarioPisado.map((d: { fecha: string }) => [d.fecha, d]));
      expect(porFecha['2027-04-20']).toMatchObject({ estado_dia_previo: 'trabajando', motivo_ausencia_previo: null });
      expect(porFecha['2027-04-21']).toMatchObject({ estado_dia_previo: 'periodo_fuera_trabajo', motivo_ausencia_previo: 'vacaciones' });
    });
  });
});

// ─── Atomicidad ─────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('resolver_pasaje_request: atomicidad', () => {
  it('si falla el upsert de rotation_assignments, no persiste ni el UPDATE de estado ni el INSERT de audit_log', async () => {
    await asAdminSuperuser(async (c) => {
      await c.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_pasaje_cal CHECK (fecha <> '2027-04-25')
      `);

      await callExpectingThrow(
        c,
        `SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`,
        [REQ_ATOMICIDAD_CAL]
      );

      const { rows: reqRows } = await c.query(`SELECT estado FROM pasaje_requests WHERE id = $1`, [REQ_ATOMICIDAD_CAL]);
      expect(reqRows[0].estado).toBe('pendiente');

      const { rows: auditRows } = await c.query(`SELECT * FROM audit_log WHERE record_id = $1`, [REQ_ATOMICIDAD_CAL]);
      expect(auditRows).toHaveLength(0);

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-04-25'`,
        [IDS.employee3]
      );
      expect(calRows).toHaveLength(0);
      // El ROLLBACK final de asAdminSuperuser descarta también el ALTER TABLE (DDL transaccional).
    });
  });

  it('simétrico: si falla el INSERT a audit_log, tampoco persiste el UPDATE de pasaje_requests ni el upsert de rotation_assignments', async () => {
    await asAdminSuperuser(async (c) => {
      await c.query(`
        ALTER TABLE audit_log
        ADD CONSTRAINT test_force_fail_pasaje_audit CHECK (action <> 'pasaje_approved')
      `);

      await callExpectingThrow(
        c,
        `SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`,
        [REQ_ATOMICIDAD_AUDIT]
      );

      const { rows: reqRows } = await c.query(`SELECT estado FROM pasaje_requests WHERE id = $1`, [REQ_ATOMICIDAD_AUDIT]);
      expect(reqRows[0].estado).toBe('pendiente');

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-04-26'`,
        [IDS.employee3]
      );
      expect(calRows).toHaveLength(0);
    });
  });

  it('fallo a mitad de un array de días sueltos revierte TODAS las filas de la invocación, incluidas las ya insertadas antes de la que falla', async () => {
    // Setup DDL privilegiado (fixture): agrega temporalmente un CHECK que
    // fuerza el fallo en el día del medio. ALTER TABLE requiere el rol
    // propietario de la tabla (no authenticated), así que corre en una
    // conexión aparte, committeada de una (fuera de la invocación afirmada
    // abajo) para que sea visible en la conexión separada de asUser(); se
    // limpia explícitamente en el finally.
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    try {
      // dias_viaje = [04-27, 04-28, 04-29]; el FOREACH itera en orden del
      // array, así que al forzar el fallo en 04-28, 04-27 ya se habría
      // insertado en la MISMA transacción antes de llegar al error — la
      // prueba real de atomicidad es que también desaparece.
      await setupClient.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_pasaje_multi CHECK (fecha <> '2027-04-28')
      `);

      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(
          c,
          `SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`,
          [REQ_ATOMICIDAD_MULTI]
        );

        const { rows: reqRows } = await c.query(`SELECT estado FROM pasaje_requests WHERE id = $1`, [REQ_ATOMICIDAD_MULTI]);
        expect(reqRows[0].estado).toBe('pendiente');

        const { rows: auditRows } = await c.query(`SELECT * FROM audit_log WHERE record_id = $1`, [REQ_ATOMICIDAD_MULTI]);
        expect(auditRows).toHaveLength(0);

        const { rows: calRows } = await c.query(
          `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = ANY ($2::date[])`,
          [IDS.employee3, ['2027-04-27', '2027-04-28', '2027-04-29']]
        );
        expect(calRows).toHaveLength(0);
      });
    } finally {
      await setupClient.query(`ALTER TABLE rotation_assignments DROP CONSTRAINT IF EXISTS test_force_fail_pasaje_multi`);
      await setupClient.end();
    }
  });
});

// ─── Guardas ────────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('resolver_pasaje_request: guardas de §6.1', () => {
  it('empleado (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_DIAS_SUELTOS])
      ).rejects.toThrow();
    });
  });

  it('supervisor (no-admin) invoca la función → abort', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_DIAS_SUELTOS])
      ).rejects.toThrow();
    });
  });

  it('anon no puede ejecutar la función (GRANT lo bloquea antes de llegar a la guarda interna)', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_DIAS_SUELTOS])
      ).rejects.toThrow();
    });
  });

  it('solicitud ya resuelta → abort (no doble aprobación, FOR UPDATE)', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_YA_RESUELTA])
      ).rejects.toThrow();
    });
  });

  it('rechazo sin motivo (NULL) → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'rechazar', NULL)`, [REQ_PARA_RECHAZAR])
      ).rejects.toThrow();
    });
  });

  it('rechazo con motivo en blanco (solo espacios) → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'rechazar', $2)`, [REQ_PARA_RECHAZAR, '   '])
      ).rejects.toThrow();
    });
  });

  it('acción inválida → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, $2, NULL)`, [REQ_DIAS_SUELTOS, 'archivar'])
      ).rejects.toThrow();
    });
  });

  it('solicitud inexistente → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [
          '00000000-0000-0000-0000-000000000000',
        ])
      ).rejects.toThrow();
    });
  });

  it('aprobar una fila con dias_viaje NULL (legacy, previa a FB-F4-08) → abort con mensaje amigable, no el error crudo de FOREACH', async () => {
    await asUser(IDS.admin, async (c) => {
      // SAVEPOINT: un RAISE EXCEPTION no capturado deja la transacción
      // abortada — cualquier query posterior (el SELECT de abajo) fallaría
      // con "current transaction is aborted" sin este rollback parcial
      // (mismo criterio que callExpectingThrow, acá inline porque además
      // se afirma el mensaje de error específico).
      await c.query('SAVEPOINT sp_sin_dias');
      await expect(
        c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [REQ_SIN_DIAS])
      ).rejects.toThrow(/días de viaje/);
      await c.query('ROLLBACK TO SAVEPOINT sp_sin_dias');

      const { rows } = await c.query(`SELECT estado FROM pasaje_requests WHERE id = $1`, [REQ_SIN_DIAS]);
      expect(rows[0].estado).toBe('pendiente');
    });
  });
});

// ─── CHECK de columna (sin pasar por la RPC) ─────────────────────

describe.skipIf(!dbAvailable)('pasaje_requests.dias_viaje: CHECK pasaje_requests_dias_viaje_no_vacio', () => {
  it('dias_viaje = {} (array vacío) es rechazado por el CHECK', async () => {
    await expect(
      asServiceRole(async (c) => {
        await c.query(
          `INSERT INTO pasaje_requests
             (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje)
           VALUES
             (gen_random_uuid(), $1, $1, 'traslado_proyectos', '2027-05-01', 'Base', 'Sitio', '{}'::date[])`,
          [IDS.employee1]
        );
      })
    ).rejects.toThrow();
  });

  it('dias_viaje = NULL (fila legacy) es permitido por el CHECK', async () => {
    await asServiceRole(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO pasaje_requests
           (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje)
         VALUES
           (gen_random_uuid(), $1, $1, 'traslado_proyectos', '2027-05-01', 'Base', 'Sitio', NULL)
         RETURNING id`,
        [IDS.employee1]
      );
      expect(rows).toHaveLength(1);
    });
  });
});
