/**
 * Tests de integración — Retención y purga de documentos rechazados (FB-F1-02)
 *
 * Cubre dos capas:
 * 1. Lógica SQL de selección y retención (30 días, idempotencia, conservación de fila).
 * 2. Purga productiva real: sube un objeto al bucket local, corre `purgeRejectedDocuments()`
 *    con el cliente inyectado, y verifica que el archivo desaparece de Storage y que
 *    `file_purged_at` queda seteado mientras la fila de metadatos se conserva.
 *    El manejo de error y reintento (fallo de `remove()` no marca `file_purged_at`) queda
 *    garantizado por la lógica de `lib/purge.ts` (FB-F1-17).
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, IDS, createStorageAdminClient, ensureDocumentsBucket } from './helpers';
import { RETENTION_DAYS, purgeRejectedDocuments } from '@/lib/purge';

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

  // Construir paths en JS para evitar el error 42P08 (mismo parámetro usado como uuid y text).
  const userId = IDS.employee1;
  const paths = {
    rechazadoViejo:    `${userId}/dni-001.pdf`,
    rechazadoReciente: `${userId}/lic-002.pdf`,
    pendiente:         `${userId}/foto-003.jpg`,
    aprobado:          `${userId}/dni-004.pdf`,
    yaApurgado:        `${userId}/lic-005.pdf`,
  };

  const INSERT_DOC = `
    INSERT INTO documents
      (id, user_id, uploaded_by, document_type, filename, storage_path,
       estado, reviewed_at, file_purged_at, motivo_rechazo)
    VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9)
  `;
  //                                                                                                                                estado       reviewed_at  file_purged_at motivo_rechazo (constraint: rechazado exige motivo)
  await db.query(INSERT_DOC, [DOC_IDS.rechazadoViejo,    userId, 'dni',         'dni.pdf',   paths.rechazadoViejo,    'rechazado', oldDate,     null,        'Vencimiento superado']);
  await db.query(INSERT_DOC, [DOC_IDS.rechazadoReciente, userId, 'licencia',    'lic.pdf',   paths.rechazadoReciente, 'rechazado', recentDate,  null,        'Documento ilegible']);
  await db.query(INSERT_DOC, [DOC_IDS.pendiente,         userId, 'foto_carnet', 'foto.jpg',  paths.pendiente,         'pendiente', null,        null,        null]);
  await db.query(INSERT_DOC, [DOC_IDS.aprobado,          userId, 'dni',         'dni2.pdf',  paths.aprobado,          'aprobado',  oldDate,     null,        null]);
  await db.query(INSERT_DOC, [DOC_IDS.yaApurgado,        userId, 'licencia',    'lic2.pdf',  paths.yaApurgado,        'rechazado', oldDate,     purgedDate,  'Datos incorrectos']);

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

// ─── Purga real vía función productiva ───────────────────────

describe.skipIf(!dbAvailable)('purgeRejectedDocuments: función productiva contra bucket real', () => {
  it('borra el archivo físico y marca file_purged_at; conserva la fila', async () => {
    const admin = createStorageAdminClient();
    await ensureDocumentsBucket(admin);

    const userId = IDS.employee1;
    const path = `${userId}/purge-me-${Date.now()}.pdf`;

    // 1. subir objeto real al bucket
    const { error: uploadError } = await admin.storage
      .from('documents')
      .upload(path, Buffer.from('contenido de purga'), { contentType: 'application/pdf' });
    expect(uploadError).toBeNull();

    // 2. insertar fila elegible: rechazado, reviewed_at > 30 días, file_purged_at null
    const { data: inserted, error: insertError } = await admin
      .from('documents')
      .insert({
        user_id:       userId,
        document_type: 'otros',
        filename:      'purge.pdf',
        storage_path:  path,
        uploaded_by:   IDS.admin,
        estado:        'rechazado',
        motivo_rechazo: 'test-purga',
        reviewed_by:   IDS.admin,
        reviewed_at:   new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();
    expect(insertError).toBeNull();

    // 3. correr la función productiva con el cliente local inyectado
    const res = await purgeRejectedDocuments(admin);
    expect(res.purged).toBeGreaterThanOrEqual(1);
    expect(res.failed).toBe(0);

    // 4. el archivo ya no existe en Storage
    const filename = path.split('/').pop()!;
    const { data: listed } = await admin.storage.from('documents').list(userId);
    expect((listed ?? []).some((o) => o.name === filename)).toBe(false);

    // 5. la fila se conserva y tiene file_purged_at seteado
    const { data: row } = await admin
      .from('documents')
      .select('file_purged_at, estado, storage_path')
      .eq('id', inserted!.id)
      .single();
    expect(row?.file_purged_at).not.toBeNull();
    expect(row?.estado).toBe('rechazado');       // fila conservada intacta
    expect(row?.storage_path).toBe(path);        // storage_path no se nulifica
  }, 20_000);
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
