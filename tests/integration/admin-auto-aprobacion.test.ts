/**
 * Tests de integración — auto-aprobación de admin-para-sí (FB-ADJ-01)
 *
 * Confirma, contra Postgres real, la premisa de la inspección de FB-ADJ-01:
 * sin migración hace falta porque `ausencias_insert_admin`/`pasajes_insert_admin`
 * ya permiten a un admin insertar una fila propia sin restricción de estado,
 * y ni `resolver_ausencia_request` ni `resolver_pasaje_request` tienen guarda
 * de auto-aprobación (solicitante ≠ aprobador) — el único gate es `is_admin()`
 * + `estado='pendiente'`. Estos tests ejercitan, bajo `asUser(IDS.admin, ...)`
 * (rol `authenticated` + claims de admin — el camino de ejecución real, no
 * postgres/superusuario), la MISMA secuencia de dos pasos que hace la Server
 * Action (crear pendiente → invocar la RPC con p_accion='aprobar'):
 *
 *  1. Happy path (ausencia y pasaje): la solicitud queda `aprobado`,
 *     `reviewed_by`/`reviewed_at` = el propio admin, el calendario del admin
 *     queda escrito (`periodo_fuera_trabajo`/`en_viaje`), `audit_log`
 *     completo, y no queda ninguna fila `pendiente` de esa solicitud (no
 *     aparecería en la bandeja Aprobaciones).
 *  2. Limpieza de huérfanas: la policy `*_delete_admin` habilita al admin a
 *     borrar la fila `pendiente` que él mismo insertó — el mecanismo del que
 *     depende la Server Action cuando la resolución falla a mitad de camino
 *     (ver createAusenciaRequest/createPasajeRequest, tests/unit).
 *
 * La guarda `is_admin()` de las RPCs y sus demás invariantes (rechazo,
 * atomicidad, expansión de rango/días) ya están cubiertas en
 * resolver-ausencia-request.test.ts / resolver-pasaje-request.test.ts — acá
 * no se repiten, solo se prueba la combinación INSERT-admin + RPC-aprobar en
 * la misma secuencia que usa la app.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, asUser, IDS } from './helpers';

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

describe.skipIf(!dbAvailable)('admin-para-sí: ausencia — auto-aprobación (FB-ADJ-01)', () => {
  it('crear pendiente + resolver_ausencia_request(aprobar) en la misma secuencia deja la solicitud aprobada, con calendario y audit_log, sin quedar pendiente', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: insertRows } = await c.query(
        `INSERT INTO ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
         VALUES ($1, 'vacaciones', '2027-05-01', '2027-05-02', 'pendiente')
         RETURNING id`,
        [IDS.admin]
      );
      const requestId = insertRows[0].id;

      await c.query(`SELECT public.resolver_ausencia_request($1, 'aprobar', NULL)`, [requestId]);

      const { rows: reqRows } = await c.query(
        `SELECT estado, reviewed_by, reviewed_at FROM ausencia_requests WHERE id = $1`,
        [requestId]
      );
      expect(reqRows[0].estado).toBe('aprobado');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);
      expect(reqRows[0].reviewed_at).not.toBeNull();

      const { rows: calRows } = await c.query(
        `SELECT estado_dia, motivo_ausencia FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-05-01' AND '2027-05-02' ORDER BY fecha`,
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

      // No queda pendiente en la bandeja de Aprobaciones (bandeja filtra por estado='pendiente').
      const { rows: pendienteRows } = await c.query(
        `SELECT id FROM ausencia_requests WHERE id = $1 AND estado = 'pendiente'`,
        [requestId]
      );
      expect(pendienteRows).toHaveLength(0);
    });
  });

  it('policy ausencias_delete_admin permite borrar una solicitud pendiente propia — mecanismo de limpieza de huérfanas si la resolución falla', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: insertRows } = await c.query(
        `INSERT INTO ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
         VALUES ($1, 'vacaciones', '2027-05-10', '2027-05-10', 'pendiente')
         RETURNING id`,
        [IDS.admin]
      );
      const requestId = insertRows[0].id;

      const deleteResult = await c.query(`DELETE FROM ausencia_requests WHERE id = $1`, [requestId]);
      expect(deleteResult.rowCount).toBe(1);

      const { rows } = await c.query(`SELECT id FROM ausencia_requests WHERE id = $1`, [requestId]);
      expect(rows).toHaveLength(0);
    });
  });
});

describe.skipIf(!dbAvailable)('admin-para-sí: pasaje — auto-aprobación (FB-ADJ-01)', () => {
  it('crear pendiente + resolver_pasaje_request(aprobar) en la misma secuencia deja la solicitud aprobada, con calendario y audit_log, sin quedar pendiente', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: insertRows } = await c.query(
        `INSERT INTO pasaje_requests
           (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, estado)
         VALUES ($1, $1, 'traslado_proyectos', '2027-06-01', 'Base', 'Sitio', ARRAY['2027-06-01','2027-06-02']::date[], 'pendiente')
         RETURNING id`,
        [IDS.admin]
      );
      const requestId = insertRows[0].id;

      await c.query(`SELECT public.resolver_pasaje_request($1, 'aprobar', NULL)`, [requestId]);

      const { rows: reqRows } = await c.query(
        `SELECT estado, reviewed_by, reviewed_at FROM pasaje_requests WHERE id = $1`,
        [requestId]
      );
      expect(reqRows[0].estado).toBe('aprobado');
      expect(reqRows[0].reviewed_by).toBe(IDS.admin);
      expect(reqRows[0].reviewed_at).not.toBeNull();

      const { rows: calRows } = await c.query(
        `SELECT estado_dia FROM rotation_assignments
         WHERE user_id = $1 AND fecha BETWEEN '2027-06-01' AND '2027-06-02' ORDER BY fecha`,
        [IDS.admin]
      );
      expect(calRows).toHaveLength(2);
      for (const row of calRows) {
        expect(row.estado_dia).toBe('en_viaje');
      }

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

  it('policy pasajes_delete_admin permite borrar una solicitud pendiente propia — mecanismo de limpieza de huérfanas si la resolución falla', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows: insertRows } = await c.query(
        `INSERT INTO pasaje_requests
           (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, estado)
         VALUES ($1, $1, 'traslado_proyectos', '2027-06-10', 'Base', 'Sitio', ARRAY['2027-06-10']::date[], 'pendiente')
         RETURNING id`,
        [IDS.admin]
      );
      const requestId = insertRows[0].id;

      const deleteResult = await c.query(`DELETE FROM pasaje_requests WHERE id = $1`, [requestId]);
      expect(deleteResult.rowCount).toBe(1);

      const { rows } = await c.query(`SELECT id FROM pasaje_requests WHERE id = $1`, [requestId]);
      expect(rows).toHaveLength(0);
    });
  });
});
