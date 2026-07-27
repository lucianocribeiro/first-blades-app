/**
 * Test de integración DB-backed — bandeja de aprobación de ausencias
 * (FB-F3-19, generalizada a todos los motivos en FB-F4-05).
 *
 * Cubre cosas que la RPC resolver_ausencia_request (FB-F3-17/0015) no cubre,
 * porque son del lado de LECTURA de la cola (app/(app)/aprobaciones/page.tsx),
 * no de la resolución en sí:
 *
 *  1. La constraint `ausencia_requests_user_id_fkey` existe con el nombre
 *     autogenerado esperado — page.tsx arma el join embebido de PostgREST
 *     como `profiles!ausencia_requests_user_id_fkey(full_name, email)`
 *     (mismo patrón que `documents_user_id_fkey` en aprobaciones/page.tsx
 *     para documentos); si el nombre de la constraint cambiara, esa query
 *     rompería en runtime sin que ningún test de la RPC lo note.
 *  2. El filtro de la cola (FB-F4-05: solo estado = 'pendiente', SIN acotar
 *     motivo — antes limitaba a 'dia_tramite') trae exactamente lo
 *     accionable: incluye solicitudes de supervisores y de cualquier motivo,
 *     y excluye estados ya resueltos. Replica en SQL crudo bajo asUser() la
 *     misma query que arma page.tsx, mismo patrón que
 *     tests/integration/calendario-scope.test.ts.
 *  3. La previsualización de sobrescritura (FB-F4-05, no bloqueante): para
 *     el rango de una ausencia pendiente, qué días ya tienen fila en
 *     rotation_assignments (incluidos es_estimado=true), o ninguno si el
 *     rango está libre.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// Misma query que app/(app)/aprobaciones/page.tsx (sin el embed de PostgREST,
// que no es SQL — se reemplaza por un JOIN explícito equivalente). FB-F4-05:
// ya no filtra por motivo_ausencia.
const QUEUE_QUERY = `
  SELECT ar.id, p.full_name
  FROM ausencia_requests ar
  JOIN profiles p ON p.id = ar.user_id
  WHERE ar.estado = 'pendiente'
  ORDER BY ar.created_at ASC
`;

// Misma query que el loop de previsualización de sobrescritura en page.tsx
// (por solicitud: user_id + rango fecha_inicio..fecha_fin).
const OVERWRITE_QUERY = `
  SELECT fecha::text AS fecha, estado_dia, es_estimado
  FROM rotation_assignments
  WHERE user_id = $1 AND fecha BETWEEN $2 AND $3
`;

const REQ_EMPLEADO    = 'e1000000-0000-0000-0002-000000000001'; // employee1, dia_tramite, pendiente
const REQ_SUPERVISOR  = 'e1000000-0000-0000-0002-000000000002'; // supervisor, dia_tramite, pendiente
const REQ_OTRO_MOTIVO = 'e1000000-0000-0000-0002-000000000003'; // employee2, vacaciones, pendiente
const REQ_YA_RESUELTA = 'e1000000-0000-0000-0002-000000000004'; // employee2, dia_tramite, aprobado

const REQ_OVERWRITE_RANGO = 'e1000000-0000-0000-0002-000000000005'; // employee3, vacaciones, 2027-08-10..14
const REQ_OVERWRITE_VACIO = 'e1000000-0000-0000-0002-000000000006'; // employee1, licencia_medica, 2027-08-20..22

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await db.query(`
    INSERT INTO ausencia_requests
      (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, created_at, reviewed_by, reviewed_at)
    VALUES
      ($1, $2, 'dia_tramite', '2027-05-01', '2027-05-01', 'pendiente', now(), NULL, NULL),
      ($3, $4, 'dia_tramite', '2027-05-02', '2027-05-02', 'pendiente', now() + interval '1 second', NULL, NULL),
      ($5, $6, 'vacaciones',  '2027-05-03', '2027-05-05', 'pendiente', now() + interval '2 seconds', NULL, NULL),
      ($7, $8, 'dia_tramite', '2027-05-06', '2027-05-06', 'aprobado', now() + interval '3 seconds', $9, now()),
      ($10, $11, 'vacaciones', '2027-08-10', '2027-08-14', 'pendiente', now() + interval '4 seconds', NULL, NULL),
      ($12, $13, 'licencia_medica', '2027-08-20', '2027-08-22', 'pendiente', now() + interval '5 seconds', NULL, NULL)
  `, [
    REQ_EMPLEADO, IDS.employee1,
    REQ_SUPERVISOR, IDS.supervisor,
    REQ_OTRO_MOTIVO, IDS.employee2,
    REQ_YA_RESUELTA, IDS.employee2,
    IDS.admin,
    REQ_OVERWRITE_RANGO, IDS.employee3,
    REQ_OVERWRITE_VACIO, IDS.employee1,
  ]);

  // Días ya cargados en el calendario de employee3, dentro del rango de
  // REQ_OVERWRITE_RANGO (2027-08-10..14) — uno de ellos es_estimado=true.
  await db.query(`
    INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
    VALUES
      ($1, '2027-08-11', 'trabajando', false),
      ($1, '2027-08-13', 'periodo_fuera_trabajo', true)
  `, [IDS.employee3]);
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: constraint del join embebido', () => {
  it('ausencia_requests_user_id_fkey existe sobre ausencia_requests(user_id) → profiles(id)', async () => {
    const { rows } = await db.query(`
      SELECT conrelid::regclass::text AS tabla, confrelid::regclass::text AS referenciada
      FROM pg_constraint
      WHERE conname = 'ausencia_requests_user_id_fkey' AND contype = 'f'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].tabla).toBe('ausencia_requests');
    expect(rows[0].referenciada).toBe('profiles');
  });
});

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: filtro de la cola (FB-F4-05: cualquier motivo + pendiente)', () => {
  it('admin ve las pendientes de cualquier motivo, incluidas las de un supervisor', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(
        expect.arrayContaining([REQ_EMPLEADO, REQ_SUPERVISOR, REQ_OTRO_MOTIVO, REQ_OVERWRITE_RANGO, REQ_OVERWRITE_VACIO])
      );
      expect(rows.find((r) => r.id === REQ_SUPERVISOR)?.full_name).toBe('Supervisor Test');
    });
  });

  it('ya NO excluye otro motivo_ausencia (vacaciones) pendiente — regresión del scope generalizado', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      expect(rows.map((r) => r.id)).toContain(REQ_OTRO_MOTIVO);
    });
  });

  it('excluye una solicitud ya resuelta (estado aprobado), sea cual sea el motivo', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      expect(rows.map((r) => r.id)).not.toContain(REQ_YA_RESUELTA);
    });
  });
});

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: previsualización de sobrescritura (FB-F4-05, no bloqueante)', () => {
  it('un rango con días ya asignados devuelve exactamente esos días, incluido uno es_estimado=true', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(OVERWRITE_QUERY, [IDS.employee3, '2027-08-10', '2027-08-14']);
      const sorted = rows.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
      expect(sorted).toEqual([
        { fecha: '2027-08-11', estado_dia: 'trabajando', es_estimado: false },
        { fecha: '2027-08-13', estado_dia: 'periodo_fuera_trabajo', es_estimado: true },
      ]);
    });
  });

  it('un rango totalmente libre no reporta ningún día', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(OVERWRITE_QUERY, [IDS.employee1, '2027-08-20', '2027-08-22']);
      expect(rows).toHaveLength(0);
    });
  });
});
