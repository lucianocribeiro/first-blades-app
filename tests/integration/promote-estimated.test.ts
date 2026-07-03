/**
 * Test de integración DB-backed — cron de promoción estimado → real
 * (FB-F3-07).
 *
 * Corre la función productiva real (promoteEstimatedDays) contra Postgres,
 * con el cliente service-role local inyectado (mismo patrón que
 * tests/integration/purge.test.ts::purgeRejectedDocuments). Se le pasa un
 * `today` fijo (no la fecha real del reloj) para que el resultado sea
 * determinístico sin importar cuándo corra el test.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, IDS, createStorageAdminClient } from './helpers';
import { promoteEstimatedDays } from '@/lib/rotation/promote-estimated';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// today fijo = '2026-07-01' → cutoff = hoy + 7 = '2026-07-08' (getPromotionCutoff).
const TODAY = '2026-07-01';

const ROWS = {
  dentroVentana:      { id: '70000000-0000-0000-0001-000000000001', fecha: '2026-07-05' }, // < cutoff
  bordeVentana:       { id: '70000000-0000-0000-0001-000000000002', fecha: '2026-07-08' }, // = cutoff (lte, inclusive)
  fueraVentana:       { id: '70000000-0000-0000-0001-000000000003', fecha: '2026-07-10' }, // > cutoff
  yaReal:             { id: '70000000-0000-0000-0001-000000000004', fecha: '2026-07-02' }, // control: ya es_estimado=false
};

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await db.query(`
    INSERT INTO rotation_assignments (id, user_id, fecha, estado_dia, es_estimado)
    VALUES
      ($1, $5, '2026-07-05', 'trabajando', true),
      ($2, $5, '2026-07-08', 'trabajando', true),
      ($3, $5, '2026-07-10', 'trabajando', true),
      ($4, $5, '2026-07-02', 'trabajando', false)
    ON CONFLICT DO NOTHING
  `, [
    ROWS.dentroVentana.id,
    ROWS.bordeVentana.id,
    ROWS.fueraVentana.id,
    ROWS.yaReal.id,
    IDS.employee1,
  ]);
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

async function getEsEstimado(id: string): Promise<boolean> {
  const { rows } = await db.query('SELECT es_estimado FROM rotation_assignments WHERE id = $1', [id]);
  return rows[0].es_estimado;
}

describe.skipIf(!dbAvailable)('promoteEstimatedDays: función productiva contra Postgres real', () => {
  it('promueve las fechas dentro de la ventana (incluido el límite exacto), no toca las de afuera ni las ya reales', async () => {
    const admin = createStorageAdminClient();

    const result = await promoteEstimatedDays(admin, TODAY);

    expect(result.promoted).toBe(2); // dentroVentana + bordeVentana

    expect(await getEsEstimado(ROWS.dentroVentana.id)).toBe(false);
    expect(await getEsEstimado(ROWS.bordeVentana.id)).toBe(false);
    expect(await getEsEstimado(ROWS.fueraVentana.id)).toBe(true); // sigue estimado
    expect(await getEsEstimado(ROWS.yaReal.id)).toBe(false); // control: no cambió
  });

  it('idempotencia: correrlo de nuevo con el mismo "today" no promueve nada más', async () => {
    const admin = createStorageAdminClient();

    const result = await promoteEstimatedDays(admin, TODAY);

    expect(result.promoted).toBe(0);

    // Estado final idéntico al de la corrida anterior.
    expect(await getEsEstimado(ROWS.dentroVentana.id)).toBe(false);
    expect(await getEsEstimado(ROWS.bordeVentana.id)).toBe(false);
    expect(await getEsEstimado(ROWS.fueraVentana.id)).toBe(true);
  });
});
