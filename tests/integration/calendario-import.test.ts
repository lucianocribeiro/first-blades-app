/**
 * Test de integración DB-backed — import del calendario desde Excel
 * (FB-PI-11 / FB-PI-11-B): RPC importar_calendario (migración 0022) +
 * lecturas de la previsualización, contra PostgREST real del Supabase local
 * con el JWT de cada rol (RLS y guardas reales).
 *
 * El circuito es el de la app, pieza por pieza: export real
 * (fetchCalendarioExportData + buildCalendarioWorkbook) → archivo editado
 * con exceljs → parseCalendarioWorkbook → validarFilasImport →
 * fetchImportContext + calcularPlanImport (la previsualización) → RPC con
 * los conteos vistos. La Server Action en sí (requireAdmin + cookies) está
 * cubierta en tests/unit/calendario-import-action.test.ts.
 *
 * Cubre:
 *  1. Ida y vuelta: exportar y reimportar sin cambios deja la base IGUAL
 *     (todas las columnas, incluidos id, updated_at y es_estimado), cero
 *     diferencias. También con ~2300 filas.
 *  2. Escritura: crear, modificar, celda vacía = borrar, es_estimado por
 *     fecha, notas y detalle.
 *  3. Pisar un día de solicitud aprobada: se pisa, la previsualización lo
 *     lista, la solicitud NO cambia, audit_log = 1 resumen + 1 por día
 *     pisado (modelo híbrido).
 *  4. Atomicidad: una fila inválida en el lote → nada escrito, nada
 *     auditado.
 *  5. Concurrencia: si el calendario cambió desde la previsualización, la
 *     RPC aborta (SQLSTATE propio FBC01, no 40001: PostgREST reintenta la
 *     clase 40 sin fin) sin escribir — y responde, no se cuelga.
 *  6. Límite de rol: empleado, supervisor y anon no pueden importar.
 *  7. Matcheo de email sin distinguir mayúsculas/espacios; admin, inactivo
 *     e inexistente rechazados también en la base.
 *  8. Volumen realista: ~2300 filas en una sola llamada, dentro del
 *     statement_timeout (8 s en producción).
 *  9. FB-PI-11-C (FB-PI-AUD-11): JWT authenticated SIN perfil rechazado
 *     (guarda afirmativa); ventana de fechas revalidada en la base; la ruta
 *     de aborto ejercitada contra Postgres directo (código FBC01, nunca de
 *     la clase 40); paridad de normalizarEmail con lower(btrim()).
 */

import { Client } from 'pg';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, storageClientForUser, IDS, DB_URL } from './helpers';
import { fetchCalendarioExportData } from '@/lib/rotation/calendario-export';
import { buildCalendarioWorkbook } from '@/lib/rotation/calendario-excel';
import {
  calcularImpactoSaldo,
  calcularPlanImport,
  filasParaRpc,
  parseCalendarioWorkbook,
  sumarAnios,
  validarFilasImport,
  type ImportConteos,
  type ImportRow,
} from '@/lib/rotation/calendario-import';
import { fetchImportContext, fetchImportProfiles } from '@/lib/rotation/calendario-import-data';
import { getBusinessToday } from '@/lib/business-date';
import { normalizarEmail } from '@/lib/normalizar-email';
import { copy } from '@/lib/copy';

type XlsxInput = Parameters<ExcelJS.Xlsx['load']>[0];
type ServerClient = Parameters<typeof fetchCalendarioExportData>[0];

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

// Fechas relativas a hoy (AR): la ventana del import es [2020-01-01, hoy+2a]
// y es_estimado depende de pasado/futuro.
const HOY = getBusinessToday();
function dia(offset: number): string {
  const [y, m, d] = HOY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offset * 86_400_000).toISOString().slice(0, 10);
}
const DESDE = dia(-40);
const HASTA = dia(10);

const EMP1 = 'emp1@test.com';
const EMP2 = 'emp2@test.com';

function clientFor(userId: string): ServerClient {
  return storageClientForUser(userId) as unknown as ServerClient;
}

async function exportar(desde = DESDE, hasta = HASTA): Promise<Buffer> {
  const data = await fetchCalendarioExportData(clientFor(IDS.admin), desde, hasta);
  if (!data) throw new Error('no se pudo leer el export');
  return buildCalendarioWorkbook(data, desde, hasta);
}

// Columnas del export: 1 email · 2 nombre · 3 fecha · 4 estado · 5 motivo ·
// 6 motivo_otros · 7 notas.
type Edicion = { estado?: string | null; motivo?: string | null; motivo_otros?: string | null; notas?: string | null; email?: string };

async function editar(buffer: Buffer, ediciones: Record<string, Edicion>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as XlsxInput);
  const sheet = wb.getWorksheet(copy.calendario.excel.hojas.calendario)!;
  const pendientes = new Set(Object.keys(ediciones));
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const key = `${row.getCell(1).value}|${row.getCell(3).value}`;
    const e = ediciones[key];
    if (!e) return;
    pendientes.delete(key);
    if (e.estado !== undefined) row.getCell(4).value = e.estado;
    if (e.motivo !== undefined) row.getCell(5).value = e.motivo;
    if (e.motivo_otros !== undefined) row.getCell(6).value = e.motivo_otros;
    if (e.notas !== undefined) row.getCell(7).value = e.notas;
    if (e.email !== undefined) row.getCell(1).value = e.email;
  });
  if (pendientes.size > 0) throw new Error(`filas no encontradas en el archivo: ${[...pendientes].join(', ')}`);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// La previsualización, con las mismas piezas que la action.
async function previsualizar(buffer: Buffer) {
  const admin = clientFor(IDS.admin);
  const parsed = await parseCalendarioWorkbook(buffer);
  if (!parsed.ok) throw new Error(parsed.error);
  const profiles = await fetchImportProfiles(admin);
  if (!profiles) throw new Error('no se pudieron leer los perfiles');
  const validacion = validarFilasImport(parsed.rows, profiles);
  if (validacion.errores.length > 0) return { validacion, plan: null, saldo: [] };
  const ids = [...new Set(validacion.filas.map((f) => f.user_id))];
  const ctx = await fetchImportContext(admin, ids, validacion.desde!, validacion.hasta!);
  if (!ctx) throw new Error('no se pudo leer el contexto');
  const plan = calcularPlanImport(validacion.filas, ctx.actuales, ctx.ausencias, ctx.pasajes);
  return { validacion, plan, saldo: calcularImpactoSaldo(plan.filas, ctx.diasTramite) };
}

async function confirmar(filas: ImportRow[] | ReturnType<typeof filasParaRpc>, conteos: ImportConteos, userId = IDS.admin) {
  const lote = filas.length > 0 && 'user_id' in filas[0] ? filasParaRpc(filas as ImportRow[]) : filas;
  return clientFor(userId).rpc('importar_calendario', { p_filas: lote, p_esperado: conteos } as never);
}

async function snapshotCalendario() {
  const { rows } = await db.query(`SELECT * FROM rotation_assignments ORDER BY user_id, fecha`);
  return rows;
}

async function contarAudit(action: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = $1`, [action]);
  return rows[0].n;
}

async function limpiar() {
  await db.query(`DELETE FROM rotation_assignments`);
  await db.query(`DELETE FROM ausencia_requests`);
  await db.query(`DELETE FROM pasaje_requests`);
  await db.query(`DELETE FROM audit_log`);
}

const L = copy.status;
const M = copy.calendario.motivos;

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();
}, 60_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query(`DELETE FROM auth.users WHERE id::text LIKE 'b0000000-%'`);
    await db.query('SELECT pg_advisory_unlock_all();');
  } catch (e) {
    console.warn('[afterAll] limpieza:', e);
  } finally {
    await db.end().catch(() => undefined);
  }
});

describe.skipIf(!dbAvailable)('import del calendario: ida y vuelta (DB-backed)', () => {
  it('exportar y reimportar sin cambios deja la base IGUAL: cero diferencias, ni siquiera updated_at ni es_estimado', async () => {
    await limpiar();
    // Variedad: notas, Otros con detalle, futuros estimados, y un día pasado
    // todavía marcado estimado (el caso del cron que no corrió, PRD §7): si
    // el import reescribiera filas sin cambios, este flag lo delataría.
    await db.query(
      `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, notas, es_estimado, updated_at)
       VALUES
         ($1, $3, 'trabajando', NULL, NULL, 'turno noche', false, '2026-01-01T00:00:00Z'),
         ($1, $4, 'periodo_fuera_trabajo', 'otros', 'Mudanza', NULL, false, '2026-01-01T00:00:00Z'),
         ($1, $5, 'en_franco', NULL, NULL, NULL, true, '2026-01-01T00:00:00Z'),
         ($2, $6, 'en_viaje', NULL, NULL, NULL, true, '2026-01-01T00:00:00Z'),
         ($2, $7, 'periodo_fuera_trabajo', 'dia_tramite', NULL, NULL, false, '2026-01-01T00:00:00Z')`,
      [IDS.employee1, IDS.supervisor, dia(-30), dia(-29), dia(-28), dia(5), dia(-10)]
    );
    const antes = await snapshotCalendario();

    const { validacion, plan } = await previsualizar(await exportar());
    expect(validacion.errores).toEqual([]);
    const dias = 51; // DESDE..HASTA
    expect(plan!.conteos).toEqual({ crear: 0, modificar: 0, borrar: 0, sin_cambios: 5 * dias, pisados: 0 });

    const { data, error } = await confirmar(validacion.filas, plan!.conteos);
    expect(error).toBeNull();
    expect(data).toMatchObject({ creadas: 0, modificadas: 0, borradas: 0, sin_cambios: 5 * dias, pisadas: 0 });

    expect(await snapshotCalendario()).toEqual(antes);
    expect(await contarAudit('calendario_importado')).toBe(1);
    expect(await contarAudit('calendario_importado_dia_pisado')).toBe(0);
  });
});

describe.skipIf(!dbAvailable)('import del calendario: escritura (DB-backed)', () => {
  it('crea, modifica, borra (celda vacía) y no toca lo que no cambia; es_estimado por fecha', async () => {
    await limpiar();
    await db.query(
      `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado)
       VALUES ($1, $2, 'trabajando', false), ($1, $3, 'trabajando', false), ($1, $4, 'trabajando', false)`,
      [IDS.employee1, dia(-20), dia(-19), dia(-18)]
    );
    const intacta = (await db.query(`SELECT * FROM rotation_assignments WHERE fecha = $1`, [dia(-18)])).rows[0];

    const archivo = await editar(await exportar(), {
      [`${EMP1}|${dia(-20)}`]: { estado: L.en_franco, notas: 'cambio' }, // modificar
      [`${EMP1}|${dia(-19)}`]: { estado: null }, // borrar
      [`${EMP2}|${dia(-5)}`]: { estado: L.periodo_fuera_trabajo, motivo: M.otros, motivo_otros: 'Trámite bancario' }, // crear (pasado)
      [`${EMP2}|${dia(6)}`]: { estado: L.en_viaje }, // crear (futuro)
    });

    const { validacion, plan } = await previsualizar(archivo);
    expect(validacion.errores).toEqual([]);
    expect(plan!.conteos).toMatchObject({ crear: 2, modificar: 1, borrar: 1, pisados: 0 });

    const { error } = await confirmar(validacion.filas, plan!.conteos);
    expect(error).toBeNull();

    const { rows } = await db.query(
      `SELECT p.email, ra.fecha::text AS fecha, ra.estado_dia, ra.motivo_ausencia, ra.motivo_otros_texto, ra.notas, ra.es_estimado
       FROM rotation_assignments ra JOIN profiles p ON p.id = ra.user_id ORDER BY p.email, ra.fecha`
    );
    expect(rows).toEqual([
      { email: EMP1, fecha: dia(-20), estado_dia: 'en_franco', motivo_ausencia: null, motivo_otros_texto: null, notas: 'cambio', es_estimado: false },
      { email: EMP1, fecha: dia(-18), estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null, es_estimado: false },
      { email: EMP2, fecha: dia(-5), estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'otros', motivo_otros_texto: 'Trámite bancario', notas: null, es_estimado: false },
      { email: EMP2, fecha: dia(6), estado_dia: 'en_viaje', motivo_ausencia: null, motivo_otros_texto: null, notas: null, es_estimado: true },
    ]);
    // La fila sin cambios quedó idéntica (ni updated_at).
    expect((await db.query(`SELECT * FROM rotation_assignments WHERE fecha = $1`, [dia(-18)])).rows[0]).toEqual(intacta);
  });

  it('pisar un día de solicitud aprobada: se pisa, se lista, la solicitud NO cambia; audit_log = 1 resumen + 1 por día pisado', async () => {
    await limpiar();
    const ausenciaId = 'c0000000-0000-0000-0000-000000000001';
    await db.query(
      `INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado, reviewed_by, reviewed_at)
       VALUES ($1, $2, 'vacaciones', $3, $4, 'aprobado', $5, now())`,
      [ausenciaId, IDS.employee1, dia(-15), dia(-13), IDS.admin]
    );
    await db.query(
      `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado)
       SELECT $1, d::date, 'periodo_fuera_trabajo', 'vacaciones', false
       FROM generate_series($2::date, $3::date, interval '1 day') d`,
      [IDS.employee1, dia(-15), dia(-13)]
    );
    const solicitudAntes = (await db.query(`SELECT * FROM ausencia_requests WHERE id = $1`, [ausenciaId])).rows[0];
    const idsDias = (await db.query(`SELECT fecha::text AS fecha, id FROM rotation_assignments ORDER BY fecha`)).rows;

    const archivo = await editar(await exportar(), {
      [`${EMP1}|${dia(-15)}`]: { estado: L.trabajando, motivo: null }, // pisa (modifica)
      [`${EMP1}|${dia(-14)}`]: { estado: null, motivo: null }, // pisa (borra)
      // dia(-13) queda igual → no se pisa
    });

    const { validacion, plan } = await previsualizar(archivo);
    expect(validacion.errores).toEqual([]);
    expect(plan!.conteos).toMatchObject({ modificar: 1, borrar: 1, pisados: 2 });
    const pisados = plan!.filas.filter((f) => f.pisado).map((f) => [f.email, f.fecha, f.solicitudes]);
    expect(pisados).toEqual([
      [EMP1, dia(-15), [{ tipo: 'ausencia', id: ausenciaId }]],
      [EMP1, dia(-14), [{ tipo: 'ausencia', id: ausenciaId }]],
    ]);

    const { data, error } = await confirmar(validacion.filas, plan!.conteos);
    expect(error).toBeNull();
    const importId = (data as unknown as { import_id: string }).import_id;

    // La solicitud no se tocó.
    expect((await db.query(`SELECT * FROM ausencia_requests WHERE id = $1`, [ausenciaId])).rows[0]).toEqual(solicitudAntes);

    // audit_log: modelo híbrido.
    const { rows: audit } = await db.query(
      `SELECT action, table_name, record_id::text AS record_id, actor_id::text AS actor_id, old_data, new_data
       FROM audit_log ORDER BY action, (new_data->>'fecha')`
    );
    expect(audit).toHaveLength(3);
    const [resumen, ...porDia] = audit;
    expect(resumen).toMatchObject({
      action: 'calendario_importado',
      table_name: 'rotation_assignments',
      record_id: importId,
      actor_id: IDS.admin,
      old_data: null,
      new_data: { import_id: importId, desde: DESDE, hasta: HASTA, creadas: 0, modificadas: 1, borradas: 1, pisadas: 2 },
    });
    expect(porDia.map((a) => [a.action, a.record_id, a.new_data.accion, a.new_data.fecha])).toEqual([
      ['calendario_importado_dia_pisado', idsDias[0].id, 'modificado', dia(-15)],
      ['calendario_importado_dia_pisado', idsDias[1].id, 'borrado', dia(-14)],
    ]);
    expect(porDia[0]).toMatchObject({
      old_data: { fecha: dia(-15), estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'vacaciones' },
      new_data: { import_id: importId, estado_dia: 'trabajando', solicitudes: [{ tipo: 'ausencia', id: ausenciaId }] },
    });
  });

  it('impacto en el saldo: días de trámite importados consumen el tope del año', async () => {
    await limpiar();
    await db.query(
      `INSERT INTO rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado)
       VALUES ($1, $2, 'periodo_fuera_trabajo', 'dia_tramite', false), ($1, $3, 'periodo_fuera_trabajo', 'dia_tramite', false)`,
      [IDS.employee2, `${HOY.slice(0, 4)}-01-02`, `${HOY.slice(0, 4)}-01-03`]
    );
    const archivo = await editar(await exportar(dia(-3), dia(-1)), {
      [`${EMP2}|${dia(-3)}`]: { estado: L.periodo_fuera_trabajo, motivo: M.dia_tramite },
      [`${EMP2}|${dia(-2)}`]: { estado: L.periodo_fuera_trabajo, motivo: M.dia_tramite },
    });
    const { saldo } = await previsualizar(archivo);
    const anio = dia(-3).slice(0, 4);
    const esperado = anio === HOY.slice(0, 4) ? { antes: 2, despues: 4, excedido: true } : { antes: 0, despues: 2, excedido: false };
    expect(saldo).toEqual([expect.objectContaining({ email: EMP2, anio, tope: 3, ...esperado })]);
  });
});

describe.skipIf(!dbAvailable)('import del calendario: atomicidad y concurrencia (DB-backed)', () => {
  it('una fila inválida en el lote (saltea la app) → la RPC aborta: NADA escrito, NADA auditado', async () => {
    await limpiar();
    const lote = [
      { email: EMP1, fecha: dia(-20), estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
      { email: EMP2, fecha: dia(-20), estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'otros', motivo_otros_texto: 'a'.repeat(81), notas: null },
    ];
    const { error } = await confirmar(lote as never, { crear: 2, modificar: 0, borrar: 0, sin_cambios: 0, pisados: 0 });
    expect(error?.code).toBe('22023');
    expect(await snapshotCalendario()).toEqual([]);
    expect(await contarAudit('calendario_importado')).toBe(0);
  });

  it.each([
    ['motivo con un estado que no es Fuera del trabajo', { estado_dia: 'trabajando', motivo_ausencia: 'vacaciones' }],
    ['notas con estado vacío', { estado_dia: null, notas: 'x' }],
    ['Otros sin detalle', { estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'otros' }],
    ['detalle sin Otros', { estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'vacaciones', motivo_otros_texto: 'x' }],
  ])('la base rechaza por su cuenta: %s (22023)', async (_c, over) => {
    await limpiar();
    const fila = { email: EMP1, fecha: dia(-20), motivo_ausencia: null, motivo_otros_texto: null, notas: null, ...over };
    const { error } = await confirmar([fila] as never, { crear: 1, modificar: 0, borrar: 0, sin_cambios: 0, pisados: 0 });
    expect(error?.code).toBe('22023');
    expect(await snapshotCalendario()).toEqual([]);
  });

  it('el calendario cambió entre la previsualización y la confirmación → FBC01, nada escrito (sin reintentos de PostgREST)', async () => {
    await limpiar();
    const archivo = await editar(await exportar(), { [`${EMP1}|${dia(-20)}`]: { estado: L.trabajando } });
    const { validacion, plan } = await previsualizar(archivo);
    expect(plan!.conteos.crear).toBe(1);

    // Alguien carga ese mismo día antes de confirmar.
    await db.query(`INSERT INTO rotation_assignments (user_id, fecha, estado_dia) VALUES ($1, $2, 'en_franco')`, [IDS.employee1, dia(-20)]);
    const antes = await snapshotCalendario();

    const { error } = await confirmar(validacion.filas, plan!.conteos);
    expect(error?.code).toBe('FBC01');
    expect(await snapshotCalendario()).toEqual(antes);
    expect(await contarAudit('calendario_importado')).toBe(0);
  });

  it('sin los conteos de la previsualización la RPC no escribe (22023)', async () => {
    await limpiar();
    const fila = { email: EMP1, fecha: dia(-20), estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null };
    const { error } = await clientFor(IDS.admin).rpc('importar_calendario', { p_filas: [fila], p_esperado: {} } as never);
    expect(error?.code).toBe('22023');
    expect(await snapshotCalendario()).toEqual([]);
  });
});

describe.skipIf(!dbAvailable)('import del calendario: límite de rol y emails (DB-backed)', () => {
  const fila = (email: string) => ({ email, fecha: dia(-20), estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null });
  const UNO = { crear: 1, modificar: 0, borrar: 0, sin_cambios: 0, pisados: 0 };

  it.each([
    ['empleado', IDS.employee1],
    ['supervisor', IDS.supervisor],
  ])('%s: la guarda de la RPC rechaza (42501), nada escrito', async (_rol, userId) => {
    await limpiar();
    const { error } = await confirmar([fila(EMP1)] as never, UNO, userId);
    expect(error?.code).toBe('42501');
    expect(await snapshotCalendario()).toEqual([]);
  });

  it('anon: sin EXECUTE, ni llega a la función', async () => {
    await limpiar();
    const anon = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc('importar_calendario', { p_filas: [fila(EMP1)], p_esperado: UNO } as never);
    expect(error).not.toBeNull();
    expect(await snapshotCalendario()).toEqual([]);
  });

  it('admin: el email matchea sin distinguir mayúsculas ni espacios', async () => {
    await limpiar();
    const { error } = await confirmar([fila('  EMP1@Test.COM ')] as never, UNO);
    expect(error).toBeNull();
    expect((await snapshotCalendario())[0].user_id).toBe(IDS.employee1);
  });

  it.each([
    ['inexistente (el import nunca crea empleados)', 'nadie@test.com'],
    ['de un admin', 'admin@test.com'],
  ])('admin: email %s → 22023, nada escrito', async (_c, email) => {
    await limpiar();
    const { error } = await confirmar([fila(email)] as never, UNO);
    expect(error?.code).toBe('22023');
    expect(await snapshotCalendario()).toEqual([]);
  });

  it('admin: email de un perfil inactivo → 22023', async () => {
    await limpiar();
    await db.query(`UPDATE profiles SET status = 'inactivo' WHERE id = $1`, [IDS.employee3]);
    try {
      const { error } = await confirmar([fila('emp3@test.com')] as never, UNO);
      expect(error?.code).toBe('22023');
    } finally {
      await db.query(`UPDATE profiles SET status = 'activo' WHERE id = $1`, [IDS.employee3]);
    }
  });
});

describe.skipIf(!dbAvailable)('import del calendario: volumen realista (DB-backed)', () => {
  it('~2300 filas en una sola llamada (25 empleados × 92 días): escribe todo y el ida y vuelta da cero diferencias', async () => {
    await limpiar();
    // 25 empleados más (el trigger de auth crea el perfil).
    for (let i = 0; i < 25; i++) {
      const id = `b0000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
      await db.query(
        `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                                 raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
         VALUES ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}', false, false)
         ON CONFLICT (id) DO NOTHING`,
        [id, `vol${i}@test.com`]
      );
      await db.query(
        `UPDATE profiles SET full_name = $2, role = 'empleado', status = 'activo' WHERE id = $1::uuid`,
        [id, `Volumen ${String(i).padStart(2, '0')}`]
      );
    }

    const desde = dia(-100);
    const hasta = dia(-9); // 92 días
    const buffer = await exportar(desde, hasta);

    // Completa los 92 días de los 25 empleados de volumen.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as XlsxInput);
    const sheet = wb.getWorksheet(copy.calendario.excel.hojas.calendario)!;
    sheet.eachRow((row, n) => {
      if (n === 1 || !String(row.getCell(1).value).startsWith('vol')) return;
      const d = Number(String(row.getCell(3).value).slice(-2));
      row.getCell(4).value = d % 7 === 0 ? L.periodo_fuera_trabajo : L.trabajando;
      row.getCell(5).value = d % 7 === 0 ? M.vacaciones : null;
    });
    const archivo = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

    const { validacion, plan } = await previsualizar(archivo);
    expect(validacion.errores).toEqual([]);
    expect(validacion.filas).toHaveLength(30 * 92); // 25 de volumen + los 5 del seed
    expect(plan!.conteos).toEqual({ crear: 2300, modificar: 0, borrar: 0, sin_cambios: 5 * 92, pisados: 0 });

    const t0 = Date.now();
    const { error } = await confirmar(validacion.filas, plan!.conteos);
    const ms = Date.now() - t0;
    expect(error).toBeNull();
    // statement_timeout de authenticated en producción: 8 s.
    expect(ms).toBeLessThan(5_000);

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM rotation_assignments`);
    expect(rows[0].n).toBe(2300);

    // Ida y vuelta con volumen: reexportar y reimportar no cambia nada.
    const antes = await snapshotCalendario();
    const vuelta = await previsualizar(await exportar(desde, hasta));
    expect(vuelta.plan!.conteos).toEqual({ crear: 0, modificar: 0, borrar: 0, sin_cambios: 30 * 92, pisados: 0 });
    const { error: error2 } = await confirmar(vuelta.validacion.filas, vuelta.plan!.conteos);
    expect(error2).toBeNull();
    expect(await snapshotCalendario()).toEqual(antes);
  }, 120_000);
});

describe.skipIf(!dbAvailable)('import del calendario: FB-PI-11-C — hallazgos de FB-PI-AUD-11 (DB-backed)', () => {
  const fila = (email: string, fecha: string) => ({ email, fecha, estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null });
  const UNO = { crear: 1, modificar: 0, borrar: 0, sin_cambios: 0, pisados: 0 };

  /** Conexión directa a Postgres (sin PostgREST) como `authenticated` con el sub dado. */
  async function rpcDirecta(sub: string, filas: unknown[], esperado: unknown): Promise<{ code?: string }> {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
      await c.query('SET LOCAL ROLE authenticated');
      try {
        await c.query('SELECT public.importar_calendario($1::jsonb, $2::jsonb)', [JSON.stringify(filas), JSON.stringify(esperado)]);
        return {};
      } catch (err) {
        return { code: (err as { code?: string }).code };
      }
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
  }

  // Hallazgo 1 (bloqueante): con la guarda por negación, is_admin() NULL
  // (sub sin perfil) dejaba pasar. Ahora la condición es afirmativa.
  it('JWT authenticated SIN perfil (p. ej. usuario purgado con token vigente): 42501 por PostgREST y por Postgres directo, nada escrito', async () => {
    await limpiar();
    const sinPerfil = 'dead0000-0000-0000-0000-000000000000';
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM profiles WHERE id = $1`, [sinPerfil]);
    expect(rows[0].n).toBe(0);

    const { error } = await confirmar([fila(EMP1, dia(-20))] as never, UNO, sinPerfil);
    expect(error?.code).toBe('42501');

    expect(await rpcDirecta(sinPerfil, [fila(EMP1, dia(-20))], UNO)).toEqual({ code: '42501' });

    expect(await snapshotCalendario()).toEqual([]);
    expect(await contarAudit('calendario_importado')).toBe(0);
  });

  // Hallazgo 2: la ventana la revalida la base, no solo la app.
  it.each([
    ['anterior a 2020-01-01', '2019-12-31'],
    ['posterior a hoy + 2 años', (() => {
      const max = sumarAnios(HOY, 2);
      const [y, m, d] = max.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
    })()],
  ])('fecha %s llamando a la RPC directo (saltea la app): 22023, nada escrito', async (_c, fecha) => {
    await limpiar();
    const { error } = await confirmar([fila(EMP1, fecha)] as never, UNO);
    expect(error?.code).toBe('22023');
    expect(await snapshotCalendario()).toEqual([]);
  });

  it('los bordes de la ventana (2020-01-01 y hoy + 2 años) son válidos', async () => {
    await limpiar();
    const { error: e1 } = await confirmar([fila(EMP1, '2020-01-01')] as never, UNO);
    expect(e1).toBeNull();
    const { error: e2 } = await confirmar([fila(EMP2, sumarAnios(HOY, 2))] as never, UNO);
    expect(e2).toBeNull();
    expect(await snapshotCalendario()).toHaveLength(2);
  });

  // FB-PI-AUD-11-B (hallazgo único): el tope de 366 días de la RPC, probado
  // contra la base y no solo en la app. Las dos fechas están DENTRO de la
  // ventana [2020-01-01, hoy + 2 años], así que lo único que puede
  // rechazarlas es el tope de duración. Se verificó que este test se pone
  // ROJO si se saca `v_hasta - v_desde + 1 > 366` de la función (FB-PI-11-E).
  it('rango de 367 días llamando a la RPC directo (saltea la app): 22023 y NINGUNA fila escrita, ni auditoría', async () => {
    await limpiar();
    const desde = dia(-366);
    const hasta = dia(0); // 367 días contando ambos extremos
    expect(desde >= '2020-01-01' && hasta <= sumarAnios(HOY, 2)).toBe(true);

    const { error } = await confirmar([fila(EMP1, desde), fila(EMP1, hasta)] as never, { ...UNO, crear: 2 });

    expect(error?.code).toBe('22023');
    expect(await snapshotCalendario()).toEqual([]);
    expect(await contarAudit('calendario_importado')).toBe(0);
  });

  it('borde válido: 366 días exactos pasan y se escriben las dos filas', async () => {
    await limpiar();
    const desde = dia(-365);
    const hasta = dia(0); // 366 días contando ambos extremos

    const { error } = await confirmar([fila(EMP1, desde), fila(EMP1, hasta)] as never, { ...UNO, crear: 2 });

    expect(error).toBeNull();
    const { rows } = await db.query(`SELECT fecha::text AS fecha FROM rotation_assignments ORDER BY fecha`);
    expect(rows.map((r) => r.fecha)).toEqual([desde, hasta]);
  });

  // Hallazgo 4: la ruta de aborto, ejercitada (no el texto del SQL). Contra
  // Postgres directo, sin PostgREST de por medio, así el código que se
  // verifica es el que levanta la función — cualquiera sea la sintaxis.
  it('previsualización desactualizada: la función aborta con FBC01, nunca con la clase 40 (PostgREST 14 la reintenta sin fin)', async () => {
    await limpiar();
    const res = await rpcDirecta(IDS.admin, [fila(EMP1, dia(-20))], { ...UNO, crear: 0, sin_cambios: 1 });
    expect(res.code).toBe('FBC01');
    expect(res.code?.startsWith('40')).toBe(false);
    expect(await snapshotCalendario()).toEqual([]);
  });

  // Hallazgo 5: la normalización de la app es la del índice, comprobada
  // contra Postgres real (no contra lo que creemos que hace btrim).
  it('normalizarEmail coincide con lower(btrim(email)) de Postgres', async () => {
    const muestras = ['ana@test.com', '  Ana@Test.COM  ', 'ANA@TEST.COM', '\tana@test.com', 'ana@test.com\n', ' \t ana@test.com', 'a.b+c_d%e@sub.test.com '];
    const { rows } = await db.query(`SELECT x, lower(btrim(x)) AS clave FROM unnest($1::text[]) AS x`, [muestras]);
    for (const r of rows) expect(normalizarEmail(r.x)).toBe(r.clave);
  });
});
