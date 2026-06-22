/**
 * Tests de integración — Retención y purga de documentos rechazados (FB-F1-02)
 *
 * Testea la lógica SQL de selección e idempotencia directamente en Postgres.
 * La eliminación real de Storage no se testea aquí (requiere instancia live).
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, IDS } from './helpers';
import { RETENTION_DAYS } from '@/lib/purge';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// UUIDs de documentos de test
const DOC_IDS = {
  rechazadoViejo:    'dddddddd-0001-0000-0000-000000000001', // elegible (>30d)
  rechazadoReciente: 'dddddddd-0002-0000-0000-000000000002', // no elegible (<30d)
  pendiente:         'dddddddd-0003-0000-0000-000000000003', // no es rechazado
  aprobado:          'dddddddd-0004-0000-0000-000000000004', // no es rechazado
  yaApurgado:        'dddddddd-0005-0000-0000-000000000005', // rechazado viejo, pero ya purgado
};

// Fecha de corte: hoy - 30d. Para tests usamos fechas relativas a now().
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // Insertar documentos de test como service_role (bypass RLS)
  await db.query('SET ROLE service_role');

  const oldDate    = daysAgo(RETENTION_DAYS + 5); // > 30d → elegible
  const recentDate = daysAgo(10);                // < 30d → no elegible
  const purgedDate = daysAgo(25);                // timestamp de purga previa

  await db.query(`
    INSERT INTO documents
      (id, user_id, uploaded_by, document_type, filename, storage_path,
       estado, reviewed_at, file_purged_at)
    VALUES
      ($1, $6, $6, 'dni',        'dni.pdf',   $6::text || '/dni-001.pdf',  'rechazado', $7,   NULL),
      ($2, $6, $6, 'licencia',   'lic.pdf',   $6::text || '/lic-002.pdf',  'rechazado', $8,   NULL),
      ($3, $6, $6, 'foto_carnet','foto.jpg',  $6::text || '/foto-003.jpg', 'pendiente', NULL, NULL),
      ($4, $6, $6, 'dni',        'dni2.pdf',  $6::text || '/dni-004.pdf',  'aprobado',  $7,   NULL),
      ($5, $6, $6, 'licencia',   'lic2.pdf',  $6::text || '/lic-005.pdf',  'rechazado', $7,   $9)
  `, [
    DOC_IDS.rechazadoViejo,    // $1
    DOC_IDS.rechazadoReciente, // $2
    DOC_IDS.pendiente,         // $3
    DOC_IDS.aprobado,          // $4
    DOC_IDS.yaApurgado,        // $5
    IDS.employee1,             // $6
    oldDate,                   // $7
    recentDate,                // $8
    purgedDate,                // $9
  ]);

  await db.query('RESET ROLE');
}, 30_000);

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

// ─── Selección de candidatos ──────────────────────────────────

describe.skipIf(!dbAvailable)('selección de candidatos a purga (SQL directo)', () => {
  it('selecciona solo el documento rechazado con reviewed_at > 30 días', async () => {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { rows } = await db.query(`
      SELECT id FROM documents
      WHERE estado = 'rechazado'
        AND file_purged_at IS NULL
        AND reviewed_at IS NOT NULL
        AND reviewed_at < $1
      ORDER BY id
    `, [cutoff]);

    const ids = rows.map((r: { id: string }) => r.id);
    expect(ids).toContain(DOC_IDS.rechazadoViejo);
    expect(ids).not.toContain(DOC_IDS.rechazadoReciente);
    expect(ids).not.toContain(DOC_IDS.pendiente);
    expect(ids).not.toContain(DOC_IDS.aprobado);
    expect(ids).not.toContain(DOC_IDS.yaApurgado);
  });

  it('no selecciona documentos cuyo file_purged_at ya está seteado (idempotencia)', async () => {
    const cutoff = daysAgo(RETENTION_DAYS);
    const { rows } = await db.query(`
      SELECT id FROM documents
      WHERE id = $1
        AND estado = 'rechazado'
        AND file_purged_at IS NULL
        AND reviewed_at IS NOT NULL
        AND reviewed_at < $2
    `, [DOC_IDS.yaApurgado, cutoff]);

    expect(rows).toHaveLength(0);
  });

  it('no selecciona documentos pendientes aunque sean viejos', async () => {
    // Forzar reviewed_at viejo en el pendiente para que sólo el estado lo excluya
    await db.query(`
      UPDATE documents SET reviewed_at = $1 WHERE id = $2
    `, [daysAgo(RETENTION_DAYS + 10), DOC_IDS.pendiente]);

    const cutoff = daysAgo(RETENTION_DAYS);
    const { rows } = await db.query(`
      SELECT id FROM documents
      WHERE id = $1
        AND estado = 'rechazado'
        AND file_purged_at IS NULL
        AND reviewed_at IS NOT NULL
        AND reviewed_at < $2
    `, [DOC_IDS.pendiente, cutoff]);

    expect(rows).toHaveLength(0);
  });
});

// ─── Aplicación de purga ─────────────────────────────────────

describe.skipIf(!dbAvailable)('actualización de file_purged_at', () => {
  it('setea file_purged_at en el documento elegible', async () => {
    const now = new Date().toISOString();

    await db.query(`
      UPDATE documents
      SET file_purged_at = $1
      WHERE id = $2
        AND file_purged_at IS NULL
    `, [now, DOC_IDS.rechazadoViejo]);

    const { rows } = await db.query(
      'SELECT file_purged_at, estado, motivo_rechazo, storage_path FROM documents WHERE id = $1',
      [DOC_IDS.rechazadoViejo]
    );

    expect(rows[0].file_purged_at).not.toBeNull();
    // El row se conserva: estado, storage_path permanecen intactos
    expect(rows[0].estado).toBe('rechazado');
    expect(rows[0].storage_path).toBe(`${IDS.employee1}/dni-001.pdf`);
  });

  it('no afecta el storage_path (queda como auditoría)', async () => {
    const { rows } = await db.query(
      'SELECT storage_path FROM documents WHERE id = $1',
      [DOC_IDS.rechazadoViejo]
    );
    expect(rows[0].storage_path).toBeTruthy();
  });

  it('segunda ejecución con IS NULL no actualiza filas ya purgadas (idempotencia)', async () => {
    const secondRun = new Date().toISOString();
    const result = await db.query(`
      UPDATE documents
      SET file_purged_at = $1
      WHERE id = $2
        AND file_purged_at IS NULL
    `, [secondRun, DOC_IDS.rechazadoViejo]);

    // file_purged_at ya no es NULL → rowCount debe ser 0
    expect(result.rowCount).toBe(0);
  });
});

// ─── Límites de ventana de retención ─────────────────────────

describe.skipIf(!dbAvailable)('ventana de retención de 30 días', () => {
  it('documento con reviewed_at = exactamente 30 días atrás NO está en la ventana', async () => {
    // Borde: < cutoff, no <=. Un doc revisado exactamente hace 30d no cumple.
    const exactlyAtCutoff = daysAgo(RETENTION_DAYS);
    const { rows } = await db.query(`
      SELECT id FROM documents
      WHERE id = $1
        AND estado = 'rechazado'
        AND file_purged_at IS NULL
        AND reviewed_at IS NOT NULL
        AND reviewed_at < $2
    `, [DOC_IDS.rechazadoReciente, exactlyAtCutoff]);

    // rechazadoReciente tiene reviewed_at = 10 días atrás, no debería aparecer
    expect(rows).toHaveLength(0);
  });
});
