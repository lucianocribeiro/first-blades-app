/**
 * Test de integración DB-backed — lectura del export del calendario a Excel
 * (FB-PI-04, lib/rotation/calendario-export.ts::fetchCalendarioExportData).
 *
 * Corre la función REAL contra PostgREST del Supabase local, con un cliente
 * supabase-js autenticado como el admin (JWT real → RLS real), y genera el
 * archivo con buildCalendarioWorkbook:
 *   - los empleados inactivos NO aparecen (ni sus días);
 *   - los admins tampoco (mismo scope que el roster del admin);
 *   - más de 1000 asignaciones en el rango: la paginación trae TODAS, sin
 *     el truncado silencioso del max_rows de PostgREST (config.toml: 1000);
 *   - el archivo tiene una fila por empleado o supervisor activo × día, incluidos los
 *     días sin asignación.
 * Solo lectura sobre una base efímera; el seed de asignaciones se hace como
 * postgres (fuera de RLS) en setup.
 */

import { Client } from 'pg';
import ExcelJS from 'exceljs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, storageClientForUser, IDS } from './helpers';
import { fetchCalendarioExportData } from '@/lib/rotation/calendario-export';
import { buildCalendarioWorkbook, getExportDays } from '@/lib/rotation/calendario-excel';
import { copy } from '@/lib/copy';

// exceljs declara su propio `Buffer` global (extends ArrayBuffer), que no
// cierra con el Buffer de @types/node: el cast es solo de tipos.
type XlsxInput = Parameters<ExcelJS.Xlsx['load']>[0];

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// 2024 completo es bisiesto: 366 días (el tope del export).
const DESDE = '2024-01-01';
const HASTA = '2024-12-31';
const DIAS = getExportDays(DESDE, HASTA);

// Activos no-admin tras el setup: supervisor, supervisor2, employee1, employee2.
// employee3 se inactiva abajo. 4 × 366 = 1464 asignaciones (> 1000).
const ACTIVOS = [IDS.supervisor, IDS.supervisor2, IDS.employee1, IDS.employee2];
const INACTIVO = IDS.employee3;

// Cliente de @supabase/ssr en la app; acá supabase-js con el JWT del admin.
// Misma API de PostgREST — el cast es solo de tipos.
type ServerClient = Parameters<typeof fetchCalendarioExportData>[0];

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  await db.query(`UPDATE profiles SET status = 'inactivo' WHERE id = $1::uuid`, [INACTIVO]);

  // Todos los días del rango para activos, inactivo y admin; el día 2024-03-10
  // de employee1 queda SIN asignación a propósito (fila vacía en el archivo).
  await db.query(
    `
    INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
    SELECT u.id, d::date, 'trabajando'::estado_dia, false
    FROM unnest($1::uuid[]) AS u(id)
    CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d
    WHERE NOT (u.id = $4::uuid AND d::date = '2024-03-10'::date)
    `,
    [[...ACTIVOS, INACTIVO, IDS.admin], DESDE, HASTA, IDS.employee1]
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

describe.skipIf(!dbAvailable)('export del calendario: lectura real (DB-backed)', () => {
  it('admin: trae solo activos no-admin y TODAS sus asignaciones (paginación > 1000)', async () => {
    const admin = storageClientForUser(IDS.admin) as unknown as ServerClient;
    const data = await fetchCalendarioExportData(admin, DESDE, HASTA);

    expect(data).not.toBeNull();
    const ids = data!.employees.map((e) => e.id);
    expect([...ids].sort()).toEqual([...ACTIVOS].sort());
    expect(ids).not.toContain(INACTIVO);
    expect(ids).not.toContain(IDS.admin);

    // 4 activos × 366 días − 1 día vacío de employee1.
    expect(data!.assignments).toHaveLength(ACTIVOS.length * DIAS.length - 1);
    expect(data!.assignments.some((a) => a.user_id === INACTIVO)).toBe(false);

    // Sin duplicados entre páginas.
    const claves = new Set(data!.assignments.map((a) => `${a.user_id}|${a.fecha}`));
    expect(claves.size).toBe(data!.assignments.length);
  });

  it('el archivo: una fila por activo × día, el día sin asignación sale vacío, sin inactivos', async () => {
    const admin = storageClientForUser(IDS.admin) as unknown as ServerClient;
    const data = await fetchCalendarioExportData(admin, DESDE, HASTA);
    const buffer = await buildCalendarioWorkbook(data!, DESDE, HASTA);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as XlsxInput);
    const sheet = wb.getWorksheet(copy.calendario.excel.hojas.calendario)!;

    expect(sheet.rowCount - 1).toBe(ACTIVOS.length * DIAS.length);

    let vacias = 0;
    let filaVacia: [unknown, unknown] | null = null;
    const emails = new Set<string>();
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      emails.add(String(row.getCell(1).value));
      if (!row.getCell(4).value) {
        vacias++;
        filaVacia = [row.getCell(1).value, row.getCell(3).value];
      }
    }
    expect(vacias).toBe(1);
    expect(filaVacia).toEqual(['emp1@test.com', '2024-03-10']);
    expect(emails.has('emp3@test.com')).toBe(false);
    expect(emails.has('admin@test.com')).toBe(false);
  });
});
