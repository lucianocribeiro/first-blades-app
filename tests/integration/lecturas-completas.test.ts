/**
 * Test de integración DB-backed — FB-PI-05: lecturas de los crons por encima
 * del tope de filas de PostgREST (max_rows = 1000, supabase/config.toml).
 *
 * Corre los stores REALES de los crons (los mismos que usan las rutas de
 * /api/cron) contra PostgREST del Supabase local, con más de 1000 filas en
 * cada lectura. Si alguien saca la paginación de cualquiera de ellas, la
 * respuesta vuelve cortada en 1000 sin error y el test se pone rojo:
 *   B — franco-alerts: días recientes del calendario
 *   D — franco-alerts: avisos ya enviados (idempotencia de mails)
 *   E — document-expiry: umbrales ya enviados (idempotencia de mails)
 *   I — document-expiry: documentos aprobados con vencimiento
 * Ver docs/audits/FB-PI-05-DIAG.md §6.
 *
 * Cliente: service role, como los crons en producción (job de sistema).
 * La siembra va por SQL como postgres.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, createStorageAdminClient, IDS } from './helpers';
import { createSupabaseFrancoAlertsStore } from '@/lib/notifications/franco-alerts-store';
import { createSupabaseExpiryStore } from '@/lib/notifications/document-expiry-store';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;
let docIdsConAvisos: string[] = [];

const ACTIVOS = [IDS.supervisor, IDS.supervisor2, IDS.employee1, IDS.employee2];
const RECEPTORES = [IDS.admin, IDS.supervisor, IDS.supervisor2, IDS.employee1];

// 2024 es bisiesto: 4 × 366 = 1464 días de calendario.
const DESDE = '2024-01-01';
const HASTA = '2024-12-31';
const DIAS_CALENDARIO = ACTIVOS.length * 366;
const DOCS = 1100;
const AVISOS_FRANCO = 1100;
// 100 documentos × 3 umbrales × 4 destinatarios = 1200 avisos de vencimiento.
// (100 IDs en el .in(): ver §6.5 del diagnóstico sobre el largo del URL.)
const DOCS_CON_AVISOS = 100;
const AVISOS_VENCIMIENTO = DOCS_CON_AVISOS * 3 * RECEPTORES.length;

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await db.query(
    `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
     SELECT u.id, d::date, 'trabajando'::estado_dia, false
     FROM unnest($1::uuid[]) AS u(id)
     CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d`,
    [ACTIVOS, DESDE, HASTA]
  );

  await db.query(
    `INSERT INTO documents (user_id, uploaded_by, document_type, filename, storage_path, estado, fecha_vencimiento)
     SELECT $1::uuid, $2::uuid, 'licencia', 'doc-' || i || '.pdf', $1::text || '/doc-' || i || '.pdf',
            'aprobado'::approval_status, DATE '2030-01-01' + i
     FROM generate_series(1, $3::int) AS i`,
    [IDS.employee1, IDS.admin, DOCS]
  );

  const { rows } = await db.query(
    `SELECT id FROM documents WHERE user_id = $1::uuid ORDER BY id LIMIT $2`,
    [IDS.employee1, DOCS_CON_AVISOS]
  );
  docIdsConAvisos = rows.map((r) => r.id);

  await db.query(
    `INSERT INTO notification_log (tipo, document_id, umbral, recipient_profile_id)
     SELECT 'vencimiento_documento'::notification_type, d.id, u.umbral, r.id
     FROM unnest($1::uuid[]) AS d(id)
     CROSS JOIN (VALUES (5), (15), (30)) AS u(umbral)
     CROSS JOIN unnest($2::uuid[]) AS r(id)`,
    [docIdsConAvisos, RECEPTORES]
  );

  await db.query(
    `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
     SELECT 'sin_franco'::notification_type, $1::uuid, 48, DATE '2020-01-01' + i, $2::uuid
     FROM generate_series(1, $3::int) AS i`,
    [IDS.employee1, IDS.admin, AVISOS_FRANCO]
  );
}, 60_000);

afterAll(async () => {
  if (!dbAvailable) return;
  if (!db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } catch (e) {
    console.warn('[afterAll] no se pudo liberar el advisory lock:', e);
  } finally {
    try {
      await db.end();
    } catch (e) {
      console.warn('[afterAll] no se pudo cerrar la conexión:', e);
    }
  }
});

describe.skipIf(!dbAvailable)('crons: lecturas completas por encima de 1000 filas (DB-backed)', () => {
  it('B — franco-alerts: trae TODOS los días del calendario (1464)', async () => {
    const store = createSupabaseFrancoAlertsStore(createStorageAdminClient());
    const dias = await store.getRecentDias(ACTIVOS, DESDE, HASTA);

    expect(dias).toHaveLength(DIAS_CALENDARIO);
    const claves = new Set(dias.map((d) => `${d.user_id}|${d.fecha}`));
    expect(claves.size).toBe(DIAS_CALENDARIO);
  });

  it('D — franco-alerts: trae TODOS los avisos ya enviados (1100)', async () => {
    const store = createSupabaseFrancoAlertsStore(createStorageAdminClient());
    const enviados = await store.getSentAlerts([{ employeeId: IDS.employee1 }] as never);

    expect(enviados).toHaveLength(AVISOS_FRANCO);
  });

  it('I — document-expiry: trae TODOS los documentos con vencimiento (1100)', async () => {
    const store = createSupabaseExpiryStore(createStorageAdminClient());
    const docs = await store.getApprovedDatedDocuments();

    expect(docs).toHaveLength(DOCS);
  });

  it('E — document-expiry: trae TODOS los umbrales ya enviados (1200)', async () => {
    const store = createSupabaseExpiryStore(createStorageAdminClient());
    const enviados = await store.getSentThresholds(docIdsConAvisos);

    expect(enviados).toHaveLength(AVISOS_VENCIMIENTO);
  });
});
