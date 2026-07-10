/**
 * Test de integración DB-backed — bandeja de aprobación de ausencias (FB-F3-19).
 *
 * Cubre dos cosas que la RPC resolver_ausencia_request (FB-F3-17) no cubre,
 * porque son del lado de LECTURA de la cola (app/(app)/aprobaciones/page.tsx),
 * no de la resolución en sí:
 *
 *  1. La constraint `ausencia_requests_user_id_fkey` existe con el nombre
 *     autogenerado esperado — page.tsx arma el join embebido de PostgREST
 *     como `profiles!ausencia_requests_user_id_fkey(full_name, email)`
 *     (mismo patrón que `documents_user_id_fkey` en aprobaciones/page.tsx
 *     para documentos); si el nombre de la constraint cambiara, esa query
 *     rompería en runtime sin que ningún test de la RPC lo note.
 *  2. El filtro de la cola (motivo_ausencia = 'dia_tramite' AND estado =
 *     'pendiente') trae exactamente lo accionable: incluye solicitudes de
 *     supervisores (no son admin, la misma cola las contempla) y excluye
 *     otros motivos de ausencia y estados ya resueltos. Replica en SQL
 *     crudo bajo asUser() la misma query que arma page.tsx, mismo patrón
 *     que tests/integration/calendario-scope.test.ts.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// Misma query que app/(app)/aprobaciones/page.tsx (sin el embed de PostgREST,
// que no es SQL — se reemplaza por un JOIN explícito equivalente).
const QUEUE_QUERY = `
  SELECT ar.id, p.full_name
  FROM ausencia_requests ar
  JOIN profiles p ON p.id = ar.user_id
  WHERE ar.estado = 'pendiente' AND ar.motivo_ausencia = 'dia_tramite'
  ORDER BY ar.created_at ASC
`;

const REQ_EMPLEADO   = 'e1000000-0000-0000-0002-000000000001'; // employee1, dia_tramite, pendiente
const REQ_SUPERVISOR = 'e1000000-0000-0000-0002-000000000002'; // supervisor, dia_tramite, pendiente
const REQ_OTRO_MOTIVO = 'e1000000-0000-0000-0002-000000000003'; // employee2, vacaciones, pendiente
const REQ_YA_RESUELTA = 'e1000000-0000-0000-0002-000000000004'; // employee2, dia_tramite, aprobado

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
      ($7, $8, 'dia_tramite', '2027-05-06', '2027-05-06', 'aprobado', now() + interval '3 seconds', $9, now())
  `, [
    REQ_EMPLEADO, IDS.employee1,
    REQ_SUPERVISOR, IDS.supervisor,
    REQ_OTRO_MOTIVO, IDS.employee2,
    REQ_YA_RESUELTA, IDS.employee2,
    IDS.admin,
  ]);
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

describe.skipIf(!dbAvailable)('aprobaciones/page.tsx: filtro de la cola (dia_tramite + pendiente)', () => {
  it('admin ve exactamente las pendientes de día de trámite, incluidas las de un supervisor', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual([REQ_EMPLEADO, REQ_SUPERVISOR]);
      expect(rows.find((r) => r.id === REQ_SUPERVISOR)?.full_name).toBe('Supervisor Test');
    });
  });

  it('excluye otro motivo_ausencia (vacaciones) aunque esté pendiente', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      expect(rows.map((r) => r.id)).not.toContain(REQ_OTRO_MOTIVO);
    });
  });

  it('excluye una solicitud de día de trámite ya resuelta (estado aprobado)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(QUEUE_QUERY);
      expect(rows.map((r) => r.id)).not.toContain(REQ_YA_RESUELTA);
    });
  });
});
