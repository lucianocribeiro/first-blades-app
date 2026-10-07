/**
 * FB-PI-11 — Import del calendario: parseo, validación, plan y saldo
 * (lib/rotation/calendario-import.ts). Funciones puras, sin base.
 *
 * El archivo de entrada se arma con el generador REAL del export
 * (buildCalendarioWorkbook): el import consume exactamente el formato que
 * produce FB-PI-04. La ida y vuelta contra la base real está en
 * tests/integration/calendario-import.test.ts.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { copy } from '@/lib/copy';
import { buildCalendarioWorkbook } from '@/lib/rotation/calendario-excel';
import type { CalendarioExportData } from '@/lib/rotation/calendario-export';
import {
  calcularImpactoSaldo,
  calcularPlanImport,
  cellToFecha,
  cellToText,
  filasParaRpc,
  normalizarEmail,
  parseCalendarioWorkbook,
  sumarAnios,
  validarFilasImport,
  type CurrentAssignment,
  type ImportProfile,
  type ImportRawRow,
  type ImportRow,
} from '@/lib/rotation/calendario-import';

type XlsxInput = Parameters<ExcelJS.Xlsx['load']>[0];

const E = copy.calendario.excel.importar.errores;
const TODAY = '2026-10-07';

const PROFILES: ImportProfile[] = [
  { id: 'u-ana', email: 'ana@fb.test', full_name: 'Ana Pérez', role: 'empleado', status: 'activo' },
  { id: 'u-beto', email: 'beto@fb.test', full_name: 'Beto Gómez', role: 'supervisor', status: 'activo' },
  { id: 'u-admin', email: 'admin@fb.test', full_name: 'Admin', role: 'admin', status: 'activo' },
  { id: 'u-baja', email: 'baja@fb.test', full_name: 'De Baja', role: 'empleado', status: 'inactivo' },
];

function raw(over: Partial<ImportRawRow> = {}): ImportRawRow {
  return {
    fila: 2,
    email: 'ana@fb.test',
    fecha: '2026-07-01',
    estado: copy.status.trabajando,
    motivo: null,
    motivo_otros: null,
    notas: null,
    ...over,
  };
}

function erroresDe(rows: ImportRawRow[]) {
  return validarFilasImport(rows, PROFILES, TODAY).errores.map((e) => e.mensaje);
}

// ─── Parseo ──────────────────────────────────────────────────────────────

const DATA: CalendarioExportData = {
  employees: [
    { id: 'u-ana', full_name: 'Ana Pérez', email: 'ana@fb.test' },
    { id: 'u-beto', full_name: 'Beto Gómez', email: 'beto@fb.test' },
  ],
  assignments: [
    { user_id: 'u-ana', fecha: '2026-07-01', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: 'turno noche' },
    { user_id: 'u-ana', fecha: '2026-07-02', estado_dia: 'periodo_fuera_trabajo', motivo_ausencia: 'otros', motivo_otros_texto: 'Mudanza', notas: null },
    { user_id: 'u-beto', fecha: '2026-07-01', estado_dia: 'en_viaje', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
  ],
};

async function exportar(data = DATA, desde = '2026-07-01', hasta = '2026-07-03') {
  return buildCalendarioWorkbook(data, desde, hasta);
}

async function editar(buffer: Buffer, fn: (sheet: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as XlsxInput);
  fn(wb.getWorksheet(copy.calendario.excel.hojas.calendario)!, wb);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('parseCalendarioWorkbook', () => {
  it('lee el archivo del export: una fila por empleado × día, con las etiquetas tal cual', async () => {
    const parsed = await parseCalendarioWorkbook(await exportar());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(6);
    const ana1 = parsed.rows.find((r) => r.email === 'ana@fb.test' && r.fecha === '2026-07-01')!;
    expect(ana1).toMatchObject({ estado: copy.status.trabajando, notas: 'turno noche', motivo: null });
    const ana2 = parsed.rows.find((r) => r.email === 'ana@fb.test' && r.fecha === '2026-07-02')!;
    expect(ana2).toMatchObject({
      estado: copy.status.periodo_fuera_trabajo,
      motivo: copy.calendario.motivos.otros,
      motivo_otros: 'Mudanza',
    });
    // Día sin asignación: estado vacío.
    expect(parsed.rows.find((r) => r.email === 'ana@fb.test' && r.fecha === '2026-07-03')!.estado).toBeNull();
  });

  it('ubica las columnas por encabezado, no por posición', async () => {
    const buffer = await editar(await exportar(), (sheet) => {
      sheet.spliceColumns(2, 1); // saca "nombre": todo se corre una columna
    });
    const parsed = await parseCalendarioWorkbook(buffer);
    // nombre no es obligatoria para el import... pero sí está en el formato:
    // un archivo sin una de las columnas del export se rechaza entero.
    expect(parsed).toEqual({ ok: false, error: `${E.columnasFaltantes} nombre.` });
  });

  it('columnas reordenadas: se leen igual', async () => {
    const buffer = await editar(await exportar(), (sheet) => {
      const notas = sheet.getColumn(7).values.slice(1);
      const email = sheet.getColumn(1).values.slice(1);
      sheet.getColumn(1).values = [, ...notas] as ExcelJS.CellValue[];
      sheet.getColumn(7).values = [, ...email] as ExcelJS.CellValue[];
    });
    const parsed = await parseCalendarioWorkbook(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.find((r) => r.fecha === '2026-07-01' && r.email === 'ana@fb.test')?.notas).toBe('turno noche');
  });

  it('archivo ilegible, sin hoja Calendario o sin filas: error de archivo', async () => {
    expect(await parseCalendarioWorkbook(Buffer.from('no soy un xlsx'))).toEqual({ ok: false, error: E.archivoIlegible });

    const otra = new ExcelJS.Workbook();
    otra.addWorksheet('Otra');
    const sinHoja = Buffer.from((await otra.xlsx.writeBuffer()) as ArrayBuffer);
    expect(await parseCalendarioWorkbook(sinHoja)).toEqual({ ok: false, error: E.sinHoja });

    const vacio = await exportar({ employees: [], assignments: [] });
    expect(await parseCalendarioWorkbook(vacio)).toEqual({ ok: false, error: E.sinFilas });
  });

  it('ignora filas totalmente vacías', async () => {
    const buffer = await editar(await exportar(), (sheet) => {
      sheet.addRow([]);
      sheet.addRow(['', '', '', '', '', '', '']);
    });
    const parsed = await parseCalendarioWorkbook(buffer);
    expect(parsed.ok && parsed.rows).toHaveLength(6);
  });

  it('fecha que Excel convirtió a su formato interno (Date o serial): se normaliza a AAAA-MM-DD', async () => {
    const buffer = await editar(await exportar(), (sheet) => {
      sheet.getRow(2).getCell(3).value = new Date(Date.UTC(2026, 6, 1));
      sheet.getRow(3).getCell(3).value = 46205; // serial de 2026-07-02
    });
    const parsed = await parseCalendarioWorkbook(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].fecha).toBe('2026-07-01');
    expect(parsed.rows[1].fecha).toBe('2026-07-02');
  });
});

describe('cellToText / cellToFecha', () => {
  it('hipervínculo (Excel convierte un email tipeado), richText y fórmula', () => {
    expect(cellToText({ text: 'ana@fb.test', hyperlink: 'mailto:ana@fb.test' })).toBe('ana@fb.test');
    expect(cellToText({ richText: [{ text: 'Traba' }, { text: 'jando' }] })).toBe('Trabajando');
    expect(cellToText({ formula: 'A1', result: 'En franco' } as ExcelJS.CellFormulaValue)).toBe('En franco');
    expect(cellToText(null)).toBeNull();
    expect(cellToText(12)).toBe('12');
  });

  it('fecha: texto se deja, Date y serial se convierten, serial no entero queda como texto inválido', () => {
    expect(cellToFecha('2026-07-01')).toBe('2026-07-01');
    expect(cellToFecha(new Date(Date.UTC(2024, 1, 29)))).toBe('2024-02-29');
    expect(cellToFecha(45351)).toBe('2024-02-29');
    expect(cellToFecha(45351.5)).toBe('45351.5');
  });
});

// ─── Validación ──────────────────────────────────────────────────────────

describe('validarFilasImport', () => {
  it('fila válida: resuelve el email (sin distinguir mayúsculas ni espacios) y mapea etiquetas a enum', () => {
    const v = validarFilasImport(
      [raw({ email: '  ANA@FB.test ', estado: copy.status.periodo_fuera_trabajo, motivo: copy.calendario.motivos.vacaciones, notas: '  ok ' })],
      PROFILES,
      TODAY
    );
    expect(v.errores).toEqual([]);
    expect(v.filas).toEqual([
      {
        fila: 2,
        user_id: 'u-ana',
        email: 'ana@fb.test',
        nombre: 'Ana Pérez',
        fecha: '2026-07-01',
        estado_dia: 'periodo_fuera_trabajo',
        motivo_ausencia: 'vacaciones',
        motivo_otros_texto: null,
        notas: 'ok',
      },
    ]);
    expect(v.desde).toBe('2026-07-01');
    expect(v.hasta).toBe('2026-07-01');
  });

  it('normalizarEmail: mismo criterio que el índice lower(btrim(email)) — btrim recorta SOLO espacios', () => {
    expect(normalizarEmail('  Ana@FB.Test ')).toBe('ana@fb.test');
    expect(normalizarEmail('\tana@fb.test\n')).toBe('\tana@fb.test\n');
  });

  it('una celda de email con tab o salto de línea (pegado desde Excel) se limpia y matchea', () => {
    const v = validarFilasImport([raw({ email: 'ana@fb.test\t\n' })], PROFILES, TODAY);
    expect(v.errores).toEqual([]);
    expect(v.filas[0].user_id).toBe('u-ana');
  });

  it('sumarAnios: igual que (fecha + INTERVAL) en Postgres, 29/02 → 28/02 en año no bisiesto', () => {
    expect(sumarAnios('2026-10-07', 2)).toBe('2028-10-07');
    expect(sumarAnios('2024-02-29', 2)).toBe('2026-02-28');
    expect(sumarAnios('2024-02-29', 4)).toBe('2028-02-29');
  });

  it.each([
    ['email vacío', raw({ email: '  ' }), E.emailVacio],
    ['email inexistente: el import nunca crea empleados', raw({ email: 'nadie@fb.test' }), E.emailInexistente],
    ['email de admin', raw({ email: 'admin@fb.test' }), E.emailAdmin],
    ['email de inactivo', raw({ email: 'baja@fb.test' }), E.emailInactivo],
    ['fecha vacía', raw({ fecha: null }), E.fechaVacia],
    ['fecha inválida', raw({ fecha: '2026-02-30' }), E.fechaInvalida],
    ['fecha en otro formato', raw({ fecha: '01/07/2026' }), E.fechaInvalida],
    ['estado fuera del enum (texto pegado sobre el desplegable)', raw({ estado: 'Trabajando mucho' }), `${E.estadoInvalido} "Trabajando mucho".`],
    ['motivo fuera del enum', raw({ estado: copy.status.periodo_fuera_trabajo, motivo: 'Paseo' }), `${E.motivoInvalido} "Paseo".`],
    ['Fuera del trabajo sin motivo', raw({ estado: copy.status.periodo_fuera_trabajo }), E.motivoObligatorio],
    ['motivo con otro estado', raw({ motivo: copy.calendario.motivos.vacaciones }), E.motivoNoCorresponde],
    ['Otros sin detalle', raw({ estado: copy.status.periodo_fuera_trabajo, motivo: copy.calendario.motivos.otros }), E.detalleObligatorio],
    ['detalle sin Otros', raw({ estado: copy.status.periodo_fuera_trabajo, motivo: copy.calendario.motivos.vacaciones, motivo_otros: 'x' }), E.detalleNoCorresponde],
    ['detalle de más de 80', raw({ estado: copy.status.periodo_fuera_trabajo, motivo: copy.calendario.motivos.otros, motivo_otros: 'a'.repeat(81) }), E.detalleLargo],
    ['motivo con estado vacío', raw({ estado: null, motivo: copy.calendario.motivos.vacaciones }), E.motivoSinEstado],
    ['notas con estado vacío', raw({ estado: null, notas: 'algo' }), E.notasSinEstado],
  ])('%s → error, sin filas para confirmar', (_caso, row, mensaje) => {
    const v = validarFilasImport([row], PROFILES, TODAY);
    expect(v.errores).toContainEqual({ fila: 2, mensaje });
    expect(v.filas).toEqual([]);
  });

  it('email ambiguo (más de un perfil con el mismo email normalizado): error', () => {
    const dup = [...PROFILES, { ...PROFILES[0], id: 'u-ana-2', email: 'ANA@fb.test' }];
    expect(validarFilasImport([raw()], dup, TODAY).errores).toContainEqual({ fila: 2, mensaje: E.emailAmbiguo });
  });

  it('fecha fuera de la ventana razonable (antes de 2020 o más de 2 años adelante)', () => {
    expect(erroresDe([raw({ fecha: '2019-12-31' })])[0]).toContain(E.fechaFueraDeVentana);
    expect(erroresDe([raw({ fecha: '2028-10-08' })])[0]).toContain(E.fechaFueraDeVentana);
    expect(erroresDe([raw({ fecha: '2028-10-07' })])).toEqual([]);
  });

  it('fila duplicada (mismo empleado y día, aunque el email difiera en mayúsculas): error en ambas', () => {
    const v = validarFilasImport([raw({ fila: 2 }), raw({ fila: 9, email: 'Ana@FB.test' })], PROFILES, TODAY);
    expect(v.errores.map((e) => e.fila)).toEqual([2, 9]);
    expect(v.errores[0].mensaje).toContain(E.duplicada);
    expect(v.filas).toEqual([]);
  });

  it('rango de más de 366 días: error de archivo', () => {
    const v = validarFilasImport([raw({ fecha: '2025-01-01' }), raw({ fila: 3, fecha: '2026-01-02' })], PROFILES, TODAY);
    expect(v.errores).toContainEqual({ fila: null, mensaje: `${E.rangoExcedido} (2025-01-01 ${E.a} 2026-01-02).` });
    expect(v.filas).toEqual([]);
  });

  it('366 días exactos es válido', () => {
    const v = validarFilasImport([raw({ fecha: '2024-01-01' }), raw({ fila: 3, fecha: '2024-12-31' })], PROFILES, TODAY);
    expect(v.errores).toEqual([]);
  });

  it('estado vacío sin nada más = borrar el día (fila válida con estado_dia null)', () => {
    const v = validarFilasImport([raw({ estado: '   ' })], PROFILES, TODAY);
    expect(v.errores).toEqual([]);
    expect(v.filas[0].estado_dia).toBeNull();
  });

  it('con un solo error, NINGUNA fila queda lista para confirmar', () => {
    const v = validarFilasImport([raw(), raw({ fila: 3, fecha: '2026-07-02', email: 'nadie@fb.test' })], PROFILES, TODAY);
    expect(v.errores).toHaveLength(1);
    expect(v.filas).toEqual([]);
  });
});

// ─── Plan ────────────────────────────────────────────────────────────────

function fila(over: Partial<ImportRow> = {}): ImportRow {
  return {
    fila: 2,
    user_id: 'u-ana',
    email: 'ana@fb.test',
    nombre: 'Ana Pérez',
    fecha: '2026-07-01',
    estado_dia: 'trabajando',
    motivo_ausencia: null,
    motivo_otros_texto: null,
    notas: null,
    ...over,
  };
}

function actual(over: Partial<CurrentAssignment> = {}): CurrentAssignment {
  return {
    id: 'ra-1',
    user_id: 'u-ana',
    fecha: '2026-07-01',
    estado_dia: 'trabajando',
    motivo_ausencia: null,
    motivo_otros_texto: null,
    notas: null,
    es_estimado: false,
    ...over,
  };
}

describe('calcularPlanImport', () => {
  it('clasifica crear / modificar / borrar / sin cambios', () => {
    const plan = calcularPlanImport(
      [
        fila({ fecha: '2026-07-01' }), // igual → sin cambios
        fila({ fecha: '2026-07-02', estado_dia: 'en_franco' }), // distinto → modificar
        fila({ fecha: '2026-07-03', estado_dia: null }), // vacío con fila → borrar
        fila({ fecha: '2026-07-04', estado_dia: null }), // vacío sin fila → sin cambios
        fila({ fecha: '2026-07-05' }), // sin fila → crear
      ],
      [
        actual({ id: 'a1', fecha: '2026-07-01' }),
        actual({ id: 'a2', fecha: '2026-07-02' }),
        actual({ id: 'a3', fecha: '2026-07-03' }),
      ],
      [],
      []
    );
    expect(plan.filas.map((f) => f.accion)).toEqual(['sin_cambios', 'modificar', 'borrar', 'sin_cambios', 'crear']);
    expect(plan.conteos).toEqual({ crear: 1, modificar: 1, borrar: 1, sin_cambios: 2, pisados: 0 });
  });

  it('notas y detalle cuentan como cambio; es_estimado no (no es editable en el archivo)', () => {
    const plan = calcularPlanImport(
      [fila({ fecha: '2026-07-01', notas: 'nueva' }), fila({ fecha: '2026-07-02' })],
      [actual({ fecha: '2026-07-01' }), actual({ fecha: '2026-07-02', es_estimado: true })],
      [],
      []
    );
    expect(plan.filas.map((f) => f.accion)).toEqual(['modificar', 'sin_cambios']);
  });

  it('pisar = día cubierto por una solicitud aprobada no cancelada que el import cambia o borra', () => {
    const ausencias = [
      { id: 'aus-1', user_id: 'u-ana', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-04', post_aprobacion_tipo: null },
      { id: 'aus-cancelada', user_id: 'u-ana', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-10', post_aprobacion_tipo: 'cancelada' as const },
    ];
    const pasajes = [{ id: 'pas-1', empleado_id: 'u-ana', dias_viaje: ['2026-07-02', '2026-07-08'], post_aprobacion_tipo: 'editada' as const }];
    const vacaciones = { estado_dia: 'periodo_fuera_trabajo' as const, motivo_ausencia: 'vacaciones' as const };
    const plan = calcularPlanImport(
      [
        fila({ fecha: '2026-07-01', ...vacaciones }), // cubierto, igual → no se pisa
        fila({ fecha: '2026-07-02', estado_dia: 'trabajando' }), // cubierto (ausencia + pasaje), cambia → pisado
        fila({ fecha: '2026-07-03', estado_dia: null }), // cubierto, se borra → pisado
        fila({ fecha: '2026-07-04', ...vacaciones }), // cubierto, sin fila → crear, no se pisa
        fila({ fecha: '2026-07-06', estado_dia: 'en_franco' }), // solo la cancelada → no se pisa
      ],
      [
        actual({ fecha: '2026-07-01', ...vacaciones }),
        actual({ fecha: '2026-07-02', ...vacaciones }),
        actual({ fecha: '2026-07-03', ...vacaciones }),
        actual({ fecha: '2026-07-06' }),
      ],
      ausencias,
      pasajes
    );
    expect(plan.filas.map((f) => f.pisado)).toEqual([false, true, true, false, false]);
    expect(plan.filas[1].solicitudes).toEqual([
      { tipo: 'ausencia', id: 'aus-1' },
      { tipo: 'pasaje', id: 'pas-1' },
    ]);
    expect(plan.conteos.pisados).toBe(2);
  });

  it('ida y vuelta (unitario): el archivo del export, reimportado sobre el mismo calendario, es todo "sin cambios"', async () => {
    const parsed = await parseCalendarioWorkbook(await exportar());
    if (!parsed.ok) throw new Error(parsed.error);
    const v = validarFilasImport(parsed.rows, PROFILES, TODAY);
    expect(v.errores).toEqual([]);
    const actuales = DATA.assignments.map((a, i) => ({ ...a, id: `ra-${i}`, es_estimado: false }));
    const plan = calcularPlanImport(v.filas, actuales, [], []);
    expect(plan.conteos).toEqual({ crear: 0, modificar: 0, borrar: 0, sin_cambios: 6, pisados: 0 });
  });
});

// ─── Saldo de días de trámite ────────────────────────────────────────────

describe('calcularImpactoSaldo', () => {
  const tramite = { estado_dia: 'periodo_fuera_trabajo' as const, motivo_ausencia: 'dia_tramite' as const };

  it('suma los días de trámite importados al saldo del AÑO completo y marca el exceso del tope de 3', () => {
    const plan = calcularPlanImport(
      [fila({ fecha: '2026-07-01', ...tramite }), fila({ fecha: '2026-07-02', ...tramite })],
      [],
      [],
      []
    );
    // Dos días de trámite ya cargados en marzo (fuera del rango del archivo).
    const impacto = calcularImpactoSaldo(plan.filas, [
      { user_id: 'u-ana', fecha: '2026-03-10' },
      { user_id: 'u-ana', fecha: '2026-03-11' },
    ]);
    expect(impacto).toEqual([
      { employeeId: 'u-ana', nombre: 'Ana Pérez', email: 'ana@fb.test', anio: '2026', antes: 2, despues: 4, tope: 3, excedido: true },
    ]);
  });

  it('reemplazar o borrar un día de trámite lo descuenta', () => {
    const plan = calcularPlanImport(
      [fila({ fecha: '2026-07-01', estado_dia: null }), fila({ fecha: '2026-07-02' })],
      [actual({ fecha: '2026-07-01', ...tramite }), actual({ fecha: '2026-07-02', ...tramite })],
      [],
      []
    );
    const impacto = calcularImpactoSaldo(plan.filas, [
      { user_id: 'u-ana', fecha: '2026-07-01' },
      { user_id: 'u-ana', fecha: '2026-07-02' },
    ]);
    expect(impacto).toMatchObject([{ antes: 2, despues: 0, excedido: false }]);
  });

  it('archivo que cruza el año: un saldo por año', () => {
    const plan = calcularPlanImport(
      [fila({ fecha: '2025-12-31', ...tramite }), fila({ fecha: '2026-01-02', ...tramite })],
      [],
      [],
      []
    );
    expect(calcularImpactoSaldo(plan.filas, []).map((s) => [s.anio, s.despues])).toEqual([
      ['2025', 1],
      ['2026', 1],
    ]);
  });

  it('sin cambios en días de trámite y sin exceso: no se lista', () => {
    const plan = calcularPlanImport([fila()], [], [], []);
    expect(calcularImpactoSaldo(plan.filas, [])).toEqual([]);
  });
});

describe('filasParaRpc', () => {
  it('manda solo email normalizado, fecha y los campos editables', () => {
    expect(filasParaRpc([fila({ notas: 'n' })])).toEqual([
      { email: 'ana@fb.test', fecha: '2026-07-01', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: 'n' },
    ]);
  });
});
