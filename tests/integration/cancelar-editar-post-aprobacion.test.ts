/**
 * Tests de integración — FB-F4-12: cancelar_editar_ausencia_aprobada /
 * cancelar_editar_pasaje_aprobado (migración 0017)
 *
 * Cubre, contra Postgres real:
 *  1. Guarda LIFO: una aprobación posterior (mayor reviewed_at) que se
 *     superpone en ≥1 día bloquea cancelar/editar — mismo tipo (ausencia
 *     bloqueada por ausencia, pasaje bloqueado por pasaje) y cruzado
 *     (ausencia bloqueada por pasaje y viceversa). Objetivo sin posterior
 *     → procede. Desanidado: 3 aprobaciones apiladas sobre el mismo día —
 *     solo se puede tocar de arriba hacia abajo.
 *  2. Cancelar: borra exactamente los días del objetivo (quedan sin
 *     asignar), audita cada borrado, marca post_aprobacion_tipo=cancelada +
 *     comentario + timestamp. Guardas: sin comentario, no-admin, anon,
 *     objetivo no aprobado, objetivo ya cancelado, acción inválida,
 *     solicitud inexistente.
 *  3. Editar fechas: borra los días viejos + escribe los nuevos (con
 *     sobrescritura auditada), actualiza las fechas de la solicitud, marca
 *     editada. Atómico. Cubre ausencia (rango) y pasaje (array).
 *
 * No re-testea RLS de las tablas base (ver rls.test.ts) ni el drift de
 * columnas/función (ver migration.test.ts) — acá se prueba el
 * comportamiento de las dos RPCs SECURITY DEFINER.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS, DB_URL } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

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
async function callExpectingThrow(
  client: Client,
  sql: string,
  params: unknown[],
  messageMatch?: RegExp
): Promise<void> {
  await client.query('SAVEPOINT sp_call');
  try {
    const promise = client.query(sql, params as string[]);
    if (messageMatch) {
      await expect(promise).rejects.toThrow(messageMatch);
    } else {
      await expect(promise).rejects.toThrow();
    }
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT sp_call');
  }
}

async function insertAusencia(
  client: Client,
  opts: {
    id: string;
    userId: string;
    fechaInicio: string;
    fechaFin: string;
    estado?: string;
    reviewedAt?: string | null;
    postAprobacionTipo?: string | null;
    motivo?: string;
  }
): Promise<void> {
  const estado = opts.estado ?? 'aprobado';
  const reviewedBy = opts.reviewedAt ? IDS.admin : null;
  await client.query(
    `INSERT INTO ausencia_requests
       (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at, post_aprobacion_tipo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      opts.id,
      opts.userId,
      opts.motivo ?? 'vacaciones',
      opts.fechaInicio,
      opts.fechaFin,
      estado,
      reviewedBy,
      opts.reviewedAt ?? null,
      opts.postAprobacionTipo ?? null,
    ]
  );
}

async function insertPasaje(
  client: Client,
  opts: {
    id: string;
    empleadoId: string;
    diasViaje: string[] | null;
    estado?: string;
    reviewedAt?: string | null;
    postAprobacionTipo?: string | null;
  }
): Promise<void> {
  const estado = opts.estado ?? 'aprobado';
  const reviewedBy = opts.reviewedAt ? IDS.admin : null;
  // fecha_viaje (legacy, NOT NULL) toma el primer día de dias_viaje; si es
  // NULL (fixture de FB-F4-13 para el objetivo malformado), cae a un valor
  // fijo — la columna legacy no participa de las guardas nuevas.
  const fechaViaje = opts.diasViaje?.[0] ?? '2027-04-01';
  await client.query(
    `INSERT INTO pasaje_requests
       (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, estado, reviewed_by, reviewed_at, post_aprobacion_tipo)
     VALUES ($1, $2, $2, 'traslado_proyectos', $3, 'Base', 'Sitio', $4::date[], $5, $6, $7, $8)`,
    [
      opts.id,
      opts.empleadoId,
      fechaViaje,
      opts.diasViaje,
      estado,
      reviewedBy,
      opts.reviewedAt ?? null,
      opts.postAprobacionTipo ?? null,
    ]
  );
}

async function insertCalendarDay(
  client: Client,
  opts: { userId: string; fecha: string; estadoDia: 'periodo_fuera_trabajo' | 'en_viaje'; motivo?: string | null }
): Promise<void> {
  await client.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado)
     VALUES ($1, $2, $3, $4, false)`,
    [opts.userId, opts.fecha, opts.estadoDia, opts.motivo ?? null]
  );
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // ─── LIFO: mismo tipo — ausencia bloqueada por ausencia posterior ───────
  await insertAusencia(db, {
    id: 'f1000000-0000-0000-0001-000000000001', // LIFO_A_TARGET
    userId: IDS.employee1,
    fechaInicio: '2027-06-01',
    fechaFin: '2027-06-03',
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertAusencia(db, {
    id: 'f1000000-0000-0000-0001-000000000002', // LIFO_A_BLOQUEO (mismo tipo)
    userId: IDS.employee1,
    fechaInicio: '2027-06-03',
    fechaFin: '2027-06-05',
    reviewedAt: '2027-01-02T00:00:00Z',
  });

  // ─── LIFO: cruzado — ausencia bloqueada por pasaje posterior ────────────
  await insertAusencia(db, {
    id: 'f1000000-0000-0000-0001-000000000003', // LIFO_C_TARGET (ausencia)
    userId: IDS.employee2,
    fechaInicio: '2027-06-10',
    fechaFin: '2027-06-10',
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertPasaje(db, {
    id: 'f1000000-0000-0000-0001-000000000004', // LIFO_C_BLOQUEO (pasaje)
    empleadoId: IDS.employee2,
    diasViaje: ['2027-06-10'],
    reviewedAt: '2027-01-02T00:00:00Z',
  });

  // ─── LIFO: cruzado — pasaje bloqueado por ausencia posterior ────────────
  await insertPasaje(db, {
    id: 'f1000000-0000-0000-0001-000000000005', // LIFO_Q_TARGET (pasaje)
    empleadoId: IDS.employee3,
    diasViaje: ['2027-06-15'],
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertAusencia(db, {
    id: 'f1000000-0000-0000-0001-000000000006', // LIFO_Q_BLOQUEO (ausencia)
    userId: IDS.employee3,
    fechaInicio: '2027-06-15',
    fechaFin: '2027-06-15',
    reviewedAt: '2027-01-02T00:00:00Z',
  });

  // ─── LIFO: mismo tipo — pasaje bloqueado por pasaje posterior ───────────
  await insertPasaje(db, {
    id: 'f1000000-0000-0000-0001-000000000007', // LIFO_S_TARGET
    empleadoId: IDS.employee1,
    diasViaje: ['2027-06-20'],
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertPasaje(db, {
    id: 'f1000000-0000-0000-0001-000000000008', // LIFO_S_BLOQUEO
    empleadoId: IDS.employee1,
    diasViaje: ['2027-06-20'],
    reviewedAt: '2027-01-02T00:00:00Z',
  });

  // ─── "Es la última": cancelar happy path (sin bloqueo) ──────────────────
  await insertAusencia(db, {
    id: 'f1000000-0000-0000-0001-000000000009', // CANCEL_AUSENCIA_OK
    userId: IDS.employee1,
    fechaInicio: '2027-07-01',
    fechaFin: '2027-07-02',
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertCalendarDay(db, { userId: IDS.employee1, fecha: '2027-07-01', estadoDia: 'periodo_fuera_trabajo', motivo: 'vacaciones' });
  await insertCalendarDay(db, { userId: IDS.employee1, fecha: '2027-07-02', estadoDia: 'periodo_fuera_trabajo', motivo: 'vacaciones' });

  await insertPasaje(db, {
    id: 'f1000000-0000-0000-0001-00000000000a', // CANCEL_PASAJE_OK
    empleadoId: IDS.employee1,
    diasViaje: ['2027-07-10'],
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertCalendarDay(db, { userId: IDS.employee1, fecha: '2027-07-10', estadoDia: 'en_viaje' });

  // ─── Desanidado: 3 aprobaciones apiladas sobre el mismo día ─────────────
  await insertAusencia(db, {
    id: 'f2000000-0000-0000-0002-000000000001', // NEST_BOTTOM
    userId: IDS.employee2,
    fechaInicio: '2027-08-01',
    fechaFin: '2027-08-01',
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertAusencia(db, {
    id: 'f2000000-0000-0000-0002-000000000002', // NEST_MIDDLE
    userId: IDS.employee2,
    fechaInicio: '2027-08-01',
    fechaFin: '2027-08-01',
    reviewedAt: '2027-01-02T00:00:00Z',
  });
  await insertAusencia(db, {
    id: 'f2000000-0000-0000-0002-000000000003', // NEST_TOP
    userId: IDS.employee2,
    fechaInicio: '2027-08-01',
    fechaFin: '2027-08-01',
    reviewedAt: '2027-01-03T00:00:00Z',
  });
  // Estado real del calendario: el último upsert (NEST_TOP) es el que quedó.
  await insertCalendarDay(db, { userId: IDS.employee2, fecha: '2027-08-01', estadoDia: 'periodo_fuera_trabajo', motivo: 'vacaciones' });

  // ─── Editar fechas: happy path ausencia (rango → rango) ─────────────────
  await insertAusencia(db, {
    id: 'f4000000-0000-0000-0004-000000000001', // EDIT_AUSENCIA_OK
    userId: IDS.employee1,
    fechaInicio: '2027-09-01',
    fechaFin: '2027-09-03',
    reviewedAt: '2027-01-01T00:00:00Z',
    motivo: 'licencia_medica',
  });
  for (const fecha of ['2027-09-01', '2027-09-02', '2027-09-03']) {
    await insertCalendarDay(db, { userId: IDS.employee1, fecha, estadoDia: 'periodo_fuera_trabajo', motivo: 'licencia_medica' });
  }

  // ─── Editar fechas: happy path pasaje (array → array) ────────────────────
  await insertPasaje(db, {
    id: 'f4000000-0000-0000-0004-000000000002', // EDIT_PASAJE_OK
    empleadoId: IDS.employee2,
    diasViaje: ['2027-09-10', '2027-09-11'],
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  for (const fecha of ['2027-09-10', '2027-09-11']) {
    await insertCalendarDay(db, { userId: IDS.employee2, fecha, estadoDia: 'en_viaje' });
  }

  // ─── Editar fechas: atomicidad ausencia ──────────────────────────────────
  await insertAusencia(db, {
    id: 'f4000000-0000-0000-0004-000000000003', // EDIT_AUSENCIA_ATOMIC
    userId: IDS.employee3,
    fechaInicio: '2027-09-20',
    fechaFin: '2027-09-21',
    reviewedAt: '2027-01-01T00:00:00Z',
    motivo: 'vacaciones',
  });
  for (const fecha of ['2027-09-20', '2027-09-21']) {
    await insertCalendarDay(db, { userId: IDS.employee3, fecha, estadoDia: 'periodo_fuera_trabajo', motivo: 'vacaciones' });
  }

  // ─── Editar fechas: atomicidad pasaje ─────────────────────────────────────
  // Fechas distintas de las de EDIT_AUSENCIA_ATOMIC (mismo employee3, rango
  // nuevo 09-25..27): si coincidieran, el upsert de una pisaría la fixture
  // de la otra y el test de "no quedó nada nuevo" daría un falso positivo.
  await insertPasaje(db, {
    id: 'f4000000-0000-0000-0004-000000000004', // EDIT_PASAJE_ATOMIC
    empleadoId: IDS.employee3,
    diasViaje: ['2027-09-28'],
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertCalendarDay(db, { userId: IDS.employee3, fecha: '2027-09-28', estadoDia: 'en_viaje' });

  // ─── Cancelar: guardas ────────────────────────────────────────────────────
  await insertAusencia(db, {
    id: 'f3000000-0000-0000-0003-000000000001', // GUARD_PENDIENTE (no aprobada)
    userId: IDS.employee1,
    fechaInicio: '2027-10-01',
    fechaFin: '2027-10-01',
    estado: 'pendiente',
    reviewedAt: null,
  });
  await insertAusencia(db, {
    id: 'f3000000-0000-0000-0003-000000000002', // GUARD_YA_CANCELADA
    userId: IDS.employee1,
    fechaInicio: '2027-10-05',
    fechaFin: '2027-10-05',
    reviewedAt: '2027-01-01T00:00:00Z',
    postAprobacionTipo: 'cancelada',
  });
  await insertAusencia(db, {
    id: 'f3000000-0000-0000-0003-000000000003', // GUARD_SIN_COMENTARIO / accion invalida / etc
    userId: IDS.employee1,
    fechaInicio: '2027-10-10',
    fechaFin: '2027-10-10',
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertPasaje(db, {
    id: 'f3000000-0000-0000-0003-000000000004', // GUARD_PASAJE_SIN_COMENTARIO / accion invalida
    empleadoId: IDS.employee1,
    diasViaje: ['2027-10-15'],
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  await insertPasaje(db, {
    id: 'f3000000-0000-0000-0003-000000000005', // GUARD_PASAJE_PENDIENTE
    empleadoId: IDS.employee1,
    diasViaje: ['2027-10-16'],
    estado: 'pendiente',
    reviewedAt: null,
  });
  await insertPasaje(db, {
    id: 'f3000000-0000-0000-0003-000000000006', // GUARD_PASAJE_YA_CANCELADA
    empleadoId: IDS.employee1,
    diasViaje: ['2027-10-17'],
    reviewedAt: '2027-01-01T00:00:00Z',
    postAprobacionTipo: 'cancelada',
  });

  // ─── FB-F4-13: guardas de datos malformados / legacy ───────────────────
  // dias_viaje NULL es una fila legacy previa a FB-F4-08 — el CHECK
  // pasaje_requests_dias_viaje_no_vacio permite NULL (solo prohíbe vacío),
  // así que este fixture no necesita bypasear ningún constraint.
  await insertPasaje(db, {
    id: 'f3000000-0000-0000-0003-000000000007', // GUARD_PASAJE_DIAS_VIAJE_NULL
    empleadoId: IDS.employee1,
    diasViaje: null,
    reviewedAt: '2027-01-01T00:00:00Z',
  });
  // reviewed_at NULL con estado='aprobado': pasaje_requests no tiene un CHECK
  // equivalente a ausencia_requests_resolucion_completa, así que este drift
  // hipotético SÍ es insertable directo (a diferencia del caso de ausencia,
  // que necesita el bypass temporal del CHECK — ver el test correspondiente).
  await insertPasaje(db, {
    id: 'f3000000-0000-0000-0003-000000000008', // GUARD_PASAJE_REVIEWED_AT_NULL
    empleadoId: IDS.employee1,
    diasViaje: ['2027-10-19'],
    estado: 'aprobado',
    reviewedAt: null,
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

// ─── Guarda LIFO ────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('guarda LIFO', () => {
  it('ausencia bloqueada por ausencia posterior que se superpone (mismo tipo)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'motivo de prueba')`,
        ['f1000000-0000-0000-0001-000000000001'],
        /f1000000-0000-0000-0001-000000000002/
      );
    });
  });

  it('ausencia bloqueada por pasaje posterior que se superpone (cruzado)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'motivo de prueba')`,
        ['f1000000-0000-0000-0001-000000000003'],
        /pasaje.*f1000000-0000-0000-0001-000000000004/
      );
    });
  });

  it('pasaje bloqueado por ausencia posterior que se superpone (cruzado)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'motivo de prueba')`,
        ['f1000000-0000-0000-0001-000000000005'],
        /ausencia.*f1000000-0000-0000-0001-000000000006/
      );
    });
  });

  it('pasaje bloqueado por pasaje posterior que se superpone (mismo tipo)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'motivo de prueba')`,
        ['f1000000-0000-0000-0001-000000000007'],
        /pasaje.*f1000000-0000-0000-0001-000000000008/
      );
    });
  });

  it('editar_fechas también respeta la guarda LIFO (no solo cancelar)', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'editar_fechas', 'motivo', '2027-06-01', '2027-06-02')`,
        ['f1000000-0000-0000-0001-000000000001'],
        /f1000000-0000-0000-0001-000000000002/
      );
    });
  });

  it('desanidado: cancelar de abajo hacia arriba se bloquea; de arriba hacia abajo procede', async () => {
    await asUser(IDS.admin, async (c) => {
      const BOTTOM = 'f2000000-0000-0000-0002-000000000001';
      const MIDDLE = 'f2000000-0000-0000-0002-000000000002';
      const TOP = 'f2000000-0000-0000-0002-000000000003';

      // Bloqueadas: tienen 2 y 1 posteriores respectivamente.
      await callExpectingThrow(c, `SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'x')`, [BOTTOM], new RegExp(TOP));
      await callExpectingThrow(c, `SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'x')`, [MIDDLE], new RegExp(TOP));

      // TOP no tiene posteriores: procede.
      await c.query(`SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'libero el tope')`, [TOP]);
      const { rows: calAfterTop } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-08-01'`,
        [IDS.employee2]
      );
      expect(calAfterTop).toHaveLength(0);

      // Ahora MIDDLE queda como la última posterior no cancelada: procede.
      await c.query(`SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'ahora sí, el medio')`, [MIDDLE]);

      // Y por último BOTTOM.
      await c.query(`SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'y por último, la base')`, [BOTTOM]);

      const { rows: estados } = await c.query(
        `SELECT id, post_aprobacion_tipo FROM ausencia_requests WHERE id IN ($1, $2, $3)`,
        [BOTTOM, MIDDLE, TOP]
      );
      for (const row of estados) {
        expect(row.post_aprobacion_tipo).toBe('cancelada');
      }

      // El día del calendario solo se liberó UNA vez (cuando canceló TOP, que
      // era el único con la fila real de calendario) — MIDDLE y BOTTOM no
      // encontraron nada para borrar.
      const { rows: auditRows } = await c.query(
        `SELECT action FROM audit_log
         WHERE table_name = 'rotation_assignments' AND action = 'calendario_liberado_post_cancelacion'
           AND (old_data->>'fecha') = '2027-08-01'`
      );
      expect(auditRows).toHaveLength(1);
    });
  });
});

// ─── Cancelar: happy path + guardas ────────────────────────────────

describe.skipIf(!dbAvailable)('cancelar_editar_ausencia_aprobada / cancelar_editar_pasaje_aprobado: cancelar', () => {
  it('ausencia sin bloqueo: borra los días, audita cada borrado, marca cancelada + comentario + timestamp', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f1000000-0000-0000-0001-000000000009';
      await c.query(`SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'ya no corresponde')`, [id]);

      const { rows: reqRows } = await c.query(
        `SELECT estado, post_aprobacion_tipo, comentario_post_aprobacion, post_aprobacion_at FROM ausencia_requests WHERE id = $1`,
        [id]
      );
      expect(reqRows[0].estado).toBe('aprobado'); // overlay: no cambia el estado base
      expect(reqRows[0].post_aprobacion_tipo).toBe('cancelada');
      expect(reqRows[0].comentario_post_aprobacion).toBe('ya no corresponde');
      expect(reqRows[0].post_aprobacion_at).not.toBeNull();

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2027-07-01', '2027-07-02')`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(0);

      const { rows: auditDeletes } = await c.query(
        `SELECT old_data, new_data FROM audit_log
         WHERE table_name = 'rotation_assignments' AND action = 'calendario_liberado_post_cancelacion'
           AND (old_data->>'fecha') IN ('2027-07-01', '2027-07-02')
         ORDER BY old_data->>'fecha'`
      );
      expect(auditDeletes).toHaveLength(2);
      for (const row of auditDeletes) {
        expect(row.new_data).toBeNull();
        expect(row.old_data.estado_dia).toBe('periodo_fuera_trabajo');
      }

      const { rows: auditTransition } = await c.query(
        `SELECT action, table_name FROM audit_log WHERE table_name = 'ausencia_requests' AND record_id = $1`,
        [id]
      );
      expect(auditTransition).toHaveLength(1);
      expect(auditTransition[0].action).toBe('ausencia_cancelada_post_aprobacion');
    });
  });

  it('pasaje sin bloqueo: borra el día, audita el borrado, marca cancelada + comentario + timestamp', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f1000000-0000-0000-0001-00000000000a';
      await c.query(`SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'viaje suspendido')`, [id]);

      const { rows: reqRows } = await c.query(
        `SELECT post_aprobacion_tipo, comentario_post_aprobacion, post_aprobacion_at FROM pasaje_requests WHERE id = $1`,
        [id]
      );
      expect(reqRows[0].post_aprobacion_tipo).toBe('cancelada');
      expect(reqRows[0].comentario_post_aprobacion).toBe('viaje suspendido');
      expect(reqRows[0].post_aprobacion_at).not.toBeNull();

      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-07-10'`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(0);

      const { rows: auditTransition } = await c.query(
        `SELECT action FROM audit_log WHERE table_name = 'pasaje_requests' AND record_id = $1`,
        [id]
      );
      expect(auditTransition).toHaveLength(1);
      expect(auditTransition[0].action).toBe('pasaje_cancelado_post_aprobacion');
    });
  });

  const guardCases: Array<{
    label: string;
    fn: 'cancelar_editar_ausencia_aprobada' | 'cancelar_editar_pasaje_aprobado';
    id: string;
    accion: string;
    comentario: string | null;
  }> = [
    { label: 'ausencia: sin comentario (NULL)', fn: 'cancelar_editar_ausencia_aprobada', id: 'f3000000-0000-0000-0003-000000000003', accion: 'cancelar', comentario: null },
    { label: 'ausencia: comentario en blanco', fn: 'cancelar_editar_ausencia_aprobada', id: 'f3000000-0000-0000-0003-000000000003', accion: 'cancelar', comentario: '   ' },
    { label: 'ausencia: acción inválida', fn: 'cancelar_editar_ausencia_aprobada', id: 'f3000000-0000-0000-0003-000000000003', accion: 'archivar', comentario: 'x' },
    { label: 'ausencia: no aprobada (pendiente)', fn: 'cancelar_editar_ausencia_aprobada', id: 'f3000000-0000-0000-0003-000000000001', accion: 'cancelar', comentario: 'x' },
    { label: 'ausencia: ya cancelada', fn: 'cancelar_editar_ausencia_aprobada', id: 'f3000000-0000-0000-0003-000000000002', accion: 'cancelar', comentario: 'x' },
    { label: 'pasaje: sin comentario (NULL)', fn: 'cancelar_editar_pasaje_aprobado', id: 'f3000000-0000-0000-0003-000000000004', accion: 'cancelar', comentario: null },
    { label: 'pasaje: acción inválida', fn: 'cancelar_editar_pasaje_aprobado', id: 'f3000000-0000-0000-0003-000000000004', accion: 'archivar', comentario: 'x' },
    { label: 'pasaje: no aprobado (pendiente)', fn: 'cancelar_editar_pasaje_aprobado', id: 'f3000000-0000-0000-0003-000000000005', accion: 'cancelar', comentario: 'x' },
    { label: 'pasaje: ya cancelado', fn: 'cancelar_editar_pasaje_aprobado', id: 'f3000000-0000-0000-0003-000000000006', accion: 'cancelar', comentario: 'x' },
  ];

  for (const tc of guardCases) {
    it(`${tc.label} → abort`, async () => {
      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(c, `SELECT public.${tc.fn}($1, $2, $3)`, [tc.id, tc.accion, tc.comentario]);
      });
    });
  }

  it('solicitud de ausencia inexistente → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'x')`,
        ['00000000-0000-0000-0000-000000000000']
      );
    });
  });

  it('solicitud de pasaje inexistente → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'x')`,
        ['00000000-0000-0000-0000-000000000000']
      );
    });
  });

  it('empleado (no-admin) no puede cancelar una ausencia aprobada', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(`SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'x')`, [
          'f3000000-0000-0000-0003-000000000003',
        ])
      ).rejects.toThrow();
    });
  });

  it('supervisor (no-admin) no puede cancelar un pasaje aprobado', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expect(
        c.query(`SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'x')`, [
          'f3000000-0000-0000-0003-000000000004',
        ])
      ).rejects.toThrow();
    });
  });

  it('anon no puede ejecutar ninguna de las dos funciones (GRANT las bloquea antes de la guarda interna)', async () => {
    await asAnon(async (c) => {
      await expect(
        c.query(`SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'x')`, [
          'f3000000-0000-0000-0003-000000000003',
        ])
      ).rejects.toThrow();
      await expect(
        c.query(`SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'x')`, [
          'f3000000-0000-0000-0003-000000000004',
        ])
      ).rejects.toThrow();
    });
  });

  // ─── FB-F4-13: guardas de datos malformados / legacy ──────────────────

  it('pasaje: objetivo con dias_viaje NULL (legacy) → abort en cancelar y en editar_fechas, sin marcar', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f3000000-0000-0000-0003-000000000007';
      await callExpectingThrow(c, `SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'x')`, [id]);
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_pasaje_aprobado($1, 'editar_fechas', 'x', ARRAY['2027-10-20']::date[])`,
        [id]
      );

      const { rows } = await c.query(`SELECT post_aprobacion_tipo FROM pasaje_requests WHERE id = $1`, [id]);
      expect(rows[0].post_aprobacion_tipo).toBeNull();
    });
  });

  it('pasaje: objetivo con reviewed_at NULL (drift/legacy) → abort, sin marcar', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f3000000-0000-0000-0003-000000000008';
      await callExpectingThrow(c, `SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'x')`, [id]);

      const { rows } = await c.query(`SELECT post_aprobacion_tipo FROM pasaje_requests WHERE id = $1`, [id]);
      expect(rows[0].post_aprobacion_tipo).toBeNull();
    });
  });

  it('pasaje: objetivo con dias_viaje vacío (bypass defensivo del CHECK, drift hipotético) → abort, sin marcar', async () => {
    // pasaje_requests_dias_viaje_no_vacio prohíbe '{}' en cualquier INSERT
    // normal — este caso solo es alcanzable si el CHECK se pierde (drift de
    // esquema). Se levanta el CHECK temporalmente en una conexión aparte
    // (auto-commit, fuera de la transacción rolled-back de asUser) para
    // poder ejercitar la guarda de la RPC igual, y se restaura en el finally
    // — mismo patrón que los tests de atomicidad de este archivo.
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    const id = 'f5000000-0000-0000-0005-000000000002';
    try {
      await setupClient.query(`ALTER TABLE pasaje_requests DROP CONSTRAINT pasaje_requests_dias_viaje_no_vacio`);
      await setupClient.query(
        `INSERT INTO pasaje_requests
           (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, estado, reviewed_by, reviewed_at)
         VALUES ($1, $2, $2, 'traslado_proyectos', '2027-11-05', 'Base', 'Sitio', ARRAY[]::date[], 'aprobado', $3, now())`,
        [id, IDS.employee2, IDS.admin]
      );

      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(c, `SELECT public.cancelar_editar_pasaje_aprobado($1, 'cancelar', 'x')`, [id]);

        const { rows } = await c.query(`SELECT post_aprobacion_tipo FROM pasaje_requests WHERE id = $1`, [id]);
        expect(rows[0].post_aprobacion_tipo).toBeNull();
      });
    } finally {
      await setupClient.query(`DELETE FROM pasaje_requests WHERE id = $1`, [id]);
      await setupClient.query(`
        ALTER TABLE pasaje_requests
        ADD CONSTRAINT pasaje_requests_dias_viaje_no_vacio
        CHECK (dias_viaje IS NULL OR cardinality(dias_viaje) >= 1)
      `);
      await setupClient.end();
    }
  });

  it('ausencia: objetivo con reviewed_at NULL (bypass defensivo del CHECK, drift hipotético) → abort, sin marcar', async () => {
    // ausencia_requests_resolucion_completa exige reviewed_by/reviewed_at no
    // nulos cuando estado='aprobado' — este caso solo es alcanzable si ese
    // CHECK se pierde. Mismo patrón de bypass temporal que el test anterior.
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    const id = 'f5000000-0000-0000-0005-000000000001';
    try {
      await setupClient.query(`ALTER TABLE ausencia_requests DROP CONSTRAINT ausencia_requests_resolucion_completa`);
      await setupClient.query(
        `INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
         VALUES ($1, $2, 'vacaciones', '2027-11-01', '2027-11-01', 'aprobado', NULL, NULL)`,
        [id, IDS.employee2]
      );

      await asUser(IDS.admin, async (c) => {
        await callExpectingThrow(c, `SELECT public.cancelar_editar_ausencia_aprobada($1, 'cancelar', 'x')`, [id]);

        const { rows } = await c.query(`SELECT post_aprobacion_tipo FROM ausencia_requests WHERE id = $1`, [id]);
        expect(rows[0].post_aprobacion_tipo).toBeNull();
      });
    } finally {
      await setupClient.query(`DELETE FROM ausencia_requests WHERE id = $1`, [id]);
      await setupClient.query(`
        ALTER TABLE ausencia_requests
        ADD CONSTRAINT ausencia_requests_resolucion_completa
        CHECK (estado = 'pendiente' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
      `);
      await setupClient.end();
    }
  });
});

// ─── Editar fechas ──────────────────────────────────────────────

describe.skipIf(!dbAvailable)('cancelar_editar_ausencia_aprobada / cancelar_editar_pasaje_aprobado: editar_fechas', () => {
  it('ausencia: sin fechas nuevas → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'editar_fechas', 'x', NULL, NULL)`,
        ['f4000000-0000-0000-0004-000000000001']
      );
    });
  });

  it('pasaje: sin días nuevos → abort', async () => {
    await asUser(IDS.admin, async (c) => {
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_pasaje_aprobado($1, 'editar_fechas', 'x', NULL)`,
        ['f4000000-0000-0000-0004-000000000002']
      );
    });
  });

  // ─── FB-F4-13: rango invertido (FB-F4-AUD-08 Hallazgo Alto) ────────────

  it('ausencia: editar_fechas con rango invertido (fecha_fin < fecha_inicio) → abort, nada persiste', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f4000000-0000-0000-0004-000000000001'; // EDIT_AUSENCIA_OK, 2027-09-01..03
      await callExpectingThrow(
        c,
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'editar_fechas', 'x', '2027-09-10', '2027-09-05')`,
        [id]
      );

      const { rows: reqRows } = await c.query(
        `SELECT fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, post_aprobacion_tipo FROM ausencia_requests WHERE id = $1`,
        [id]
      );
      expect(reqRows[0].fecha_inicio).toBe('2027-09-01');
      expect(reqRows[0].fecha_fin).toBe('2027-09-03');
      expect(reqRows[0].post_aprobacion_tipo).toBeNull();

      // Los días viejos siguen intactos: la guarda abortó ANTES del borrado.
      const { rows: calRows } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha BETWEEN '2027-09-01' AND '2027-09-03'`,
        [IDS.employee1]
      );
      expect(calRows).toHaveLength(3);
    });
  });

  it('ausencia: editar_fechas con fecha_inicio = fecha_fin (un solo día) sigue permitido', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f4000000-0000-0000-0004-000000000001'; // EDIT_AUSENCIA_OK
      await c.query(
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'editar_fechas', 'un solo día', '2027-09-08', '2027-09-08')`,
        [id]
      );

      const { rows: reqRows } = await c.query(
        `SELECT fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, post_aprobacion_tipo FROM ausencia_requests WHERE id = $1`,
        [id]
      );
      expect(reqRows[0].fecha_inicio).toBe('2027-09-08');
      expect(reqRows[0].fecha_fin).toBe('2027-09-08');
      expect(reqRows[0].post_aprobacion_tipo).toBe('editada');
    });
  });

  it('ausencia: borra el rango viejo, escribe el rango nuevo, actualiza fechas y marca editada', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f4000000-0000-0000-0004-000000000001';
      await c.query(
        `SELECT public.cancelar_editar_ausencia_aprobada($1, 'editar_fechas', 'corrección de fechas', '2027-09-05', '2027-09-06')`,
        [id]
      );

      const { rows: oldDays } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha BETWEEN '2027-09-01' AND '2027-09-03'`,
        [IDS.employee1]
      );
      expect(oldDays).toHaveLength(0);

      const { rows: newDays } = await c.query(
        `SELECT fecha::text AS fecha, estado_dia, motivo_ausencia, es_estimado FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-09-05' AND '2027-09-06' ORDER BY fecha`,
        [IDS.employee1]
      );
      expect(newDays).toHaveLength(2);
      for (const row of newDays) {
        expect(row.estado_dia).toBe('periodo_fuera_trabajo');
        expect(row.motivo_ausencia).toBe('licencia_medica');
        expect(row.es_estimado).toBe(false);
      }

      const { rows: reqRows } = await c.query(
        `SELECT fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, post_aprobacion_tipo, comentario_post_aprobacion
         FROM ausencia_requests WHERE id = $1`,
        [id]
      );
      expect(reqRows[0].fecha_inicio).toBe('2027-09-05');
      expect(reqRows[0].fecha_fin).toBe('2027-09-06');
      expect(reqRows[0].post_aprobacion_tipo).toBe('editada');
      expect(reqRows[0].comentario_post_aprobacion).toBe('corrección de fechas');

      const { rows: auditDeletes } = await c.query(
        `SELECT action FROM audit_log
         WHERE table_name = 'rotation_assignments' AND action = 'calendario_liberado_post_cancelacion'
           AND (old_data->>'fecha') BETWEEN '2027-09-01' AND '2027-09-03'`
      );
      expect(auditDeletes).toHaveLength(3);

      const { rows: auditTransition } = await c.query(
        `SELECT action, new_data FROM audit_log WHERE table_name = 'ausencia_requests' AND record_id = $1`,
        [id]
      );
      expect(auditTransition).toHaveLength(1);
      expect(auditTransition[0].action).toBe('ausencia_editada_post_aprobacion');
      // FB-F4-20: ya no lleva calendario_pisado embebido.
      expect(auditTransition[0].new_data.calendario_pisado).toBeUndefined();

      // FB-F4-20: 1 fila de audit_log por cada día nuevo escrito
      // (table_name='rotation_assignments'), igual convención que pasaje.
      const { rows: auditWrites } = await c.query(
        `SELECT new_data->>'fecha' AS fecha FROM audit_log
         WHERE table_name = 'rotation_assignments' AND action = 'ausencia_calendario_sobrescrito_post_edicion'
           AND (new_data->>'fecha') IN ('2027-09-05', '2027-09-06')`
      );
      expect(auditWrites.map((r) => r.fecha).sort()).toEqual(['2027-09-05', '2027-09-06']);
    });
  });

  it('pasaje: borra los días viejos, escribe los nuevos, actualiza dias_viaje y marca editada', async () => {
    await asUser(IDS.admin, async (c) => {
      const id = 'f4000000-0000-0000-0004-000000000002';
      await c.query(
        `SELECT public.cancelar_editar_pasaje_aprobado($1, 'editar_fechas', 'cambio de itinerario', ARRAY['2027-09-15']::date[])`,
        [id]
      );

      const { rows: oldDays } = await c.query(
        `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2027-09-10', '2027-09-11')`,
        [IDS.employee2]
      );
      expect(oldDays).toHaveLength(0);

      const { rows: newDays } = await c.query(
        `SELECT estado_dia, motivo_ausencia, es_estimado FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-09-15'`,
        [IDS.employee2]
      );
      expect(newDays).toHaveLength(1);
      expect(newDays[0].estado_dia).toBe('en_viaje');
      expect(newDays[0].motivo_ausencia).toBeNull();
      expect(newDays[0].es_estimado).toBe(false);

      const { rows: reqRows } = await c.query(
        `SELECT dias_viaje::text[] AS dias_viaje, post_aprobacion_tipo, comentario_post_aprobacion FROM pasaje_requests WHERE id = $1`,
        [id]
      );
      expect(reqRows[0].dias_viaje).toEqual(['2027-09-15']);
      expect(reqRows[0].post_aprobacion_tipo).toBe('editada');

      const { rows: auditDeletes } = await c.query(
        `SELECT action FROM audit_log
         WHERE table_name = 'rotation_assignments' AND action = 'calendario_liberado_post_cancelacion'
           AND (old_data->>'fecha') IN ('2027-09-10', '2027-09-11')`
      );
      expect(auditDeletes).toHaveLength(2);

      const { rows: auditWrites } = await c.query(
        `SELECT action FROM audit_log
         WHERE table_name = 'rotation_assignments' AND action = 'pasaje_calendario_sobrescrito_post_edicion'
           AND (new_data->>'fecha') = '2027-09-15'`
      );
      expect(auditWrites).toHaveLength(1);

      const { rows: auditTransition } = await c.query(
        `SELECT action FROM audit_log WHERE table_name = 'pasaje_requests' AND record_id = $1`,
        [id]
      );
      expect(auditTransition).toHaveLength(1);
      expect(auditTransition[0].action).toBe('pasaje_editado_post_aprobacion');
    });
  });

  it('ausencia: atomicidad — un fallo a mitad del rango nuevo revierte TODO (fechas, calendario viejo y nuevo, marcador)', async () => {
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    try {
      await setupClient.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_editar_ausencia CHECK (fecha <> '2027-09-26')
      `);

      await asUser(IDS.admin, async (c) => {
        const id = 'f4000000-0000-0000-0004-000000000003';
        await callExpectingThrow(
          c,
          `SELECT public.cancelar_editar_ausencia_aprobada($1, 'editar_fechas', 'x', '2027-09-25', '2027-09-27')`,
          [id]
        );

        const { rows: reqRows } = await c.query(
          `SELECT fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, post_aprobacion_tipo FROM ausencia_requests WHERE id = $1`,
          [id]
        );
        expect(reqRows[0].fecha_inicio).toBe('2027-09-20');
        expect(reqRows[0].fecha_fin).toBe('2027-09-21');
        expect(reqRows[0].post_aprobacion_tipo).toBeNull();

        // El rango viejo NO se borró (todo o nada) y el rango nuevo tampoco quedó parcial.
        const { rows: oldDays } = await c.query(
          `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2027-09-20', '2027-09-21')`,
          [IDS.employee3]
        );
        expect(oldDays).toHaveLength(2);

        const { rows: newDays } = await c.query(
          `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha IN ('2027-09-25', '2027-09-27')`,
          [IDS.employee3]
        );
        expect(newDays).toHaveLength(0);

        const { rows: auditRows } = await c.query(
          `SELECT * FROM audit_log WHERE table_name = 'ausencia_requests' AND record_id = $1`,
          [id]
        );
        expect(auditRows).toHaveLength(0);
      });
    } finally {
      await setupClient.query(`ALTER TABLE rotation_assignments DROP CONSTRAINT IF EXISTS test_force_fail_editar_ausencia`);
      await setupClient.end();
    }
  });

  it('pasaje: atomicidad — un fallo al escribir el día nuevo revierte TODO (dias_viaje, calendario viejo y nuevo, marcador)', async () => {
    const setupClient = new Client({ connectionString: DB_URL });
    await setupClient.connect();
    try {
      await setupClient.query(`
        ALTER TABLE rotation_assignments
        ADD CONSTRAINT test_force_fail_editar_pasaje CHECK (fecha <> '2027-09-29')
      `);

      await asUser(IDS.admin, async (c) => {
        const id = 'f4000000-0000-0000-0004-000000000004';
        await callExpectingThrow(
          c,
          `SELECT public.cancelar_editar_pasaje_aprobado($1, 'editar_fechas', 'x', ARRAY['2027-09-29']::date[])`,
          [id]
        );

        const { rows: reqRows } = await c.query(
          `SELECT dias_viaje::text[] AS dias_viaje, post_aprobacion_tipo FROM pasaje_requests WHERE id = $1`,
          [id]
        );
        expect(reqRows[0].dias_viaje).toEqual(['2027-09-28']);
        expect(reqRows[0].post_aprobacion_tipo).toBeNull();

        const { rows: oldDays } = await c.query(
          `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-09-28'`,
          [IDS.employee3]
        );
        expect(oldDays).toHaveLength(1);

        const { rows: newDays } = await c.query(
          `SELECT * FROM rotation_assignments WHERE user_id = $1 AND fecha = '2027-09-29'`,
          [IDS.employee3]
        );
        expect(newDays).toHaveLength(0);

        const { rows: auditRows } = await c.query(
          `SELECT * FROM audit_log WHERE table_name = 'pasaje_requests' AND record_id = $1`,
          [id]
        );
        expect(auditRows).toHaveLength(0);
      });
    } finally {
      await setupClient.query(`ALTER TABLE rotation_assignments DROP CONSTRAINT IF EXISTS test_force_fail_editar_pasaje`);
      await setupClient.end();
    }
  });
});
