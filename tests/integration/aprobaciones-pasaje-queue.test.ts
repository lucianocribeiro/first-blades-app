/**
 * Test de integración DB-backed — bandeja de aprobación de pasajes (FB-F4-10).
 * Análogo a aprobaciones-ausencia-queue.test.ts (FB-F3-19/FB-F4-05).
 *
 * Cubre cosas que la RPC resolver_pasaje_request (FB-F4-07/08) no cubre,
 * porque son del lado de LECTURA de la cola (app/(app)/aprobaciones/page.tsx),
 * no de la resolución en sí:
 *
 *  1. Los nombres de constraint autogenerados que page.tsx usa para el join
 *     embebido de PostgREST (`profiles!pasaje_requests_solicitante_id_fkey`,
 *     `profiles!pasaje_requests_empleado_id_fkey`) existen tal cual.
 *  2. El filtro de la cola (solo estado='pendiente') trae pasajes de
 *     cualquier solicitante (empleado o supervisor pidiendo para su equipo)
 *     y excluye los ya resueltos.
 *  3. La previsualización de sobrescritura (no bloqueante): para dias_viaje
 *     (fechas DISCRETAS, no un rango — a diferencia de ausencia), qué días
 *     ya tienen fila en rotation_assignments en el calendario del
 *     EMPLEADO_ID (quien viaja, no necesariamente el solicitante), incluidos
 *     es_estimado=true.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// Mismas queries que app/(app)/aprobaciones/page.tsx (sin el embed de
// PostgREST, que no es SQL — se reemplaza por un JOIN explícito equivalente).
const QUEUE_QUERY = `
  SELECT pr.id, sp.full_name AS solicitante_nombre, ep.full_name AS empleado_nombre
  FROM pasaje_requests pr
  JOIN profiles sp ON sp.id = pr.solicitante_id
  JOIN profiles ep ON ep.id = pr.empleado_id
  WHERE pr.estado = 'pendiente'
  ORDER BY pr.created_at ASC
`;

// Filtro por dias_viaje discretos (fecha = ANY(...)), no un BETWEEN — a
// diferencia del molde de ausencia (rango contiguo).
const OVERWRITE_QUERY = `
  SELECT fecha::text AS fecha, estado_dia, es_estimado
  FROM rotation_assignments
  WHERE user_id = $1 AND fecha = ANY ($2::date[])
`;

const REQ_EMPLEADO      = 'e3000000-0000-0000-0003-000000000001'; // employee1 → employee1, pendiente
const REQ_SUPERVISOR    = 'e3000000-0000-0000-0003-000000000002'; // supervisor → employee1 (su equipo), pendiente
const REQ_YA_RESUELTA   = 'e3000000-0000-0000-0003-000000000003'; // employee2 → employee2, aprobado
const REQ_OVERWRITE_DIAS = 'e3000000-0000-0000-0003-000000000004'; // employee3 → employee3, días con colisión
const REQ_OVERWRITE_VACIO = 'e3000000-0000-0000-0003-000000000005'; // employee1 → employee1, días libres

async function insertPasaje(
  client: Client,
  opts: {
    id: string;
    solicitanteId: string;
    empleadoId: string;
    diasViaje: string[];
    estado?: string;
    reviewedBy?: string;
    createdAtOffsetSeconds?: number;
  }
): Promise<void> {
  const reviewedAt = opts.reviewedBy ? new Date() : null;
  await client.query(
    `INSERT INTO pasaje_requests
       (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, estado,
        reviewed_by, reviewed_at, created_at)
     VALUES
       ($1, $2, $3, 'traslado_proyectos', $4, 'Base', 'Sitio', $5::date[], $6, $7, $8,
        now() + make_interval(secs => $9))`,
    [
      opts.id,
      opts.solicitanteId,
      opts.empleadoId,
      opts.diasViaje[0],
      opts.diasViaje,
      opts.estado ?? 'pendiente',
      opts.reviewedBy ?? null,
      reviewedAt,
      opts.createdAtOffsetSeconds ?? 0,
    ]
  );
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await insertPasaje(db, {
    id: REQ_EMPLEADO,
    solicitanteId: IDS.employee1,
    empleadoId: IDS.employee1,
    diasViaje: ['2027-09-01'],
    createdAtOffsetSeconds: 0,
  });

  await insertPasaje(db, {
    id: REQ_SUPERVISOR,
    solicitanteId: IDS.supervisor,
    empleadoId: IDS.employee1,
    diasViaje: ['2027-09-02'],
    createdAtOffsetSeconds: 1,
  });

  await insertPasaje(db, {
    id: REQ_YA_RESUELTA,
    solicitanteId: IDS.employee2,
    empleadoId: IDS.employee2,
    diasViaje: ['2027-09-03'],
    estado: 'aprobado',
    reviewedBy: IDS.admin,
    createdAtOffsetSeconds: 2,
  });

  await insertPasaje(db, {
    id: REQ_OVERWRITE_DIAS,
    solicitanteId: IDS.employee3,
    empleadoId: IDS.employee3,
    diasViaje: ['2027-09-10', '2027-09-11', '2027-09-12'],
    createdAtOffsetSeconds: 3,
  });

  await insertPasaje(db, {
    id: REQ_OVERWRITE_VACIO,
    solicitanteId: IDS.employee1,
    empleadoId: IDS.employee1,
    diasViaje: ['2027-09-20', '2027-09-21'],
    createdAtOffsetSeconds: 4,
  });

  // Colisiones preexistentes para REQ_OVERWRITE_DIAS: 09-10 sin motivo
  // (trabajando, es_estimado=true), 09-11 libre (sin fila), 09-12 con motivo
  // (periodo_fuera_trabajo) — confirma que solo se reporta lo que realmente
  // pisa, y que el día del medio (sin colisión) no aparece.
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
     VALUES ($1, '2027-09-10', 'trabajando', true)`,
    [IDS.employee3]
  );
  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado)
     VALUES ($1, '2027-09-12', 'periodo_fuera_trabajo', 'vacaciones', false)`,
    [IDS.employee3]
  );
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: constraints del join embebido (FB-F4-10)', () => {
  it('pasaje_requests_solicitante_id_fkey y pasaje_requests_empleado_id_fkey existen sobre profiles(id)', async () => {
    const { rows } = await db.query(`
      SELECT conname, conrelid::regclass::text AS tabla, confrelid::regclass::text AS referenciada
      FROM pg_constraint
      WHERE conname IN ('pasaje_requests_solicitante_id_fkey', 'pasaje_requests_empleado_id_fkey')
        AND contype = 'f'
      ORDER BY conname
    `);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tabla).toBe('pasaje_requests');
      expect(row.referenciada).toBe('profiles');
    }
  });
});

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: filtro de la cola de pasajes', () => {
  it('admin ve las pendientes, incluidas las de un supervisor pidiendo para su equipo', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(
        expect.arrayContaining([REQ_EMPLEADO, REQ_SUPERVISOR, REQ_OVERWRITE_DIAS, REQ_OVERWRITE_VACIO])
      );
      const supervisorRow = rows.find((r) => r.id === REQ_SUPERVISOR);
      expect(supervisorRow?.solicitante_nombre).toBe('Supervisor Test');
      expect(supervisorRow?.empleado_nombre).not.toBe(supervisorRow?.solicitante_nombre);
    });
  });

  it('excluye una solicitud ya resuelta (estado aprobado)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      expect(rows.map((r) => r.id)).not.toContain(REQ_YA_RESUELTA);
    });
  });
});

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: previsualización de sobrescritura sobre dias_viaje (FB-F4-10)', () => {
  it('días discretos con colisión (incl. es_estimado=true) devuelven exactamente esos días — el día libre intermedio no aparece', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(OVERWRITE_QUERY, [
        IDS.employee3,
        ['2027-09-10', '2027-09-11', '2027-09-12'],
      ]);
      const sorted = rows.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
      expect(sorted).toEqual([
        { fecha: '2027-09-10', estado_dia: 'trabajando', es_estimado: true },
        { fecha: '2027-09-12', estado_dia: 'periodo_fuera_trabajo', es_estimado: false },
      ]);
    });
  });

  it('días totalmente libres no reportan ningún día', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(OVERWRITE_QUERY, [IDS.employee1, ['2027-09-20', '2027-09-21']]);
      expect(rows).toHaveLength(0);
    });
  });

  it('consulta el calendario del EMPLEADO_ID (quien viaja), no del solicitante', async () => {
    await asUser(IDS.admin, async (c) => {
      // REQ_SUPERVISOR: solicitante=supervisor, empleado_id=employee1. El día
      // 09-10 tiene colisión en el calendario de employee3, NO en el de
      // supervisor ni en el de employee1 — confirma que la query real
      // (parametrizada por empleado_id) no encontraría nada acá.
      const { rows } = await c.query(OVERWRITE_QUERY, [IDS.supervisor, ['2027-09-10']]);
      expect(rows).toHaveLength(0);
    });
  });
});
