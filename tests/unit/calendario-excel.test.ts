/**
 * FB-PI-04 — Generación del .xlsx del calendario
 * (lib/rotation/calendario-excel.ts). Genera el archivo real y lo vuelve a
 * leer con exceljs: filas (empleado × día, incluidos los vacíos), orden,
 * columnas, etiquetas, desplegables, celdas bloqueadas y hoja de referencia.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';

// exceljs declara su propio `Buffer` global (extends ArrayBuffer), que no
// cierra con el Buffer de @types/node: el cast es solo de tipos.
type XlsxInput = Parameters<ExcelJS.Xlsx['load']>[0];
import {
  buildCalendarioWorkbook,
  getExportDays,
  exportFilename,
  CALENDARIO_EXCEL_COLUMNS,
} from '@/lib/rotation/calendario-excel';
import type { CalendarioExportData } from '@/lib/rotation/calendario-export';
import { copy } from '@/lib/copy';

const DESDE = '2026-02-27';
const HASTA = '2026-03-02'; // cruza fin de mes: 27, 28, 1, 2 → 4 días
const DIAS = ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'];

// Ya ordenados por nombre, como los devuelve fetchCalendarioExportData.
const DATA: CalendarioExportData = {
  employees: [
    { id: 'u-ana', full_name: 'Ana Pérez', email: 'ana@firstblades.test' },
    { id: 'u-beto', full_name: 'Beto Gómez', email: 'beto@firstblades.test' },
    { id: 'u-carla', full_name: 'Carla Ruiz', email: 'carla@firstblades.test' },
  ],
  assignments: [
    { user_id: 'u-ana', fecha: '2026-02-27', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
    { user_id: 'u-ana', fecha: '2026-03-01', estado_dia: 'en_franco', motivo_ausencia: null, motivo_otros_texto: null, notas: 'franco largo' },
    {
      user_id: 'u-beto', fecha: '2026-02-28', estado_dia: 'periodo_fuera_trabajo',
      motivo_ausencia: 'otros', motivo_otros_texto: 'mudanza', notas: null,
    },
    {
      user_id: 'u-beto', fecha: '2026-03-02', estado_dia: 'periodo_fuera_trabajo',
      motivo_ausencia: 'dia_tramite', motivo_otros_texto: null, notas: null,
    },
    { user_id: 'u-beto', fecha: '2026-03-01', estado_dia: 'en_viaje', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
    // Fuera del rango: no debe aparecer.
    { user_id: 'u-carla', fecha: '2026-03-05', estado_dia: 'trabajando', motivo_ausencia: null, motivo_otros_texto: null, notas: null },
  ],
};

let workbook: ExcelJS.Workbook;
let sheet: ExcelJS.Worksheet;

function text(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  return v === null || v === undefined || v === '' ? null : String(v);
}

function dataRows() {
  const rows: Record<string, string | null>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj: Record<string, string | null> = {};
    CALENDARIO_EXCEL_COLUMNS.forEach((col, i) => {
      obj[col.key] = text(row.getCell(i + 1));
    });
    rows.push(obj);
  }
  return rows;
}

beforeAll(async () => {
  const buffer = await buildCalendarioWorkbook(DATA, DESDE, HASTA);
  workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as XlsxInput);
  sheet = workbook.getWorksheet(copy.calendario.excel.hojas.calendario)!;
});

describe('getExportDays / exportFilename', () => {
  it('días inclusive, cruzando fin de mes', () => {
    expect(getExportDays(DESDE, HASTA)).toEqual(DIAS);
  });

  it('un solo día', () => {
    expect(getExportDays('2026-05-10', '2026-05-10')).toEqual(['2026-05-10']);
  });

  it('año bisiesto: 29 de febrero incluido', () => {
    expect(getExportDays('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('el nombre del archivo incluye el rango', () => {
    expect(exportFilename(DESDE, HASTA)).toBe('calendario_2026-02-27_a_2026-03-02.xlsx');
  });
});

describe('hoja Calendario: filas', () => {
  it('encabezados en el orden del PRD', () => {
    const header = CALENDARIO_EXCEL_COLUMNS.map((_, i) => text(sheet.getRow(1).getCell(i + 1)));
    expect(header).toEqual(['email', 'nombre', 'fecha', 'estado', 'motivo', 'motivo_otros', 'notas']);
  });

  it('una fila por empleado × día del rango, incluidos los días sin asignación', () => {
    expect(sheet.rowCount - 1).toBe(DATA.employees.length * DIAS.length);
  });

  it('orden: por nombre y después por fecha', () => {
    const rows = dataRows();
    const esperado = DATA.employees.flatMap((e) => DIAS.map((d) => [e.email, e.full_name, d]));
    expect(rows.map((r) => [r.email, r.nombre, r.fecha])).toEqual(esperado);
  });

  it('días sin asignación: estado, motivo, motivo_otros y notas vacíos', () => {
    const carla = dataRows().filter((r) => r.email === 'carla@firstblades.test');
    expect(carla).toHaveLength(DIAS.length);
    for (const r of carla) {
      expect([r.estado, r.motivo, r.motivo_otros, r.notas]).toEqual([null, null, null, null]);
    }
    const anaVacio = dataRows().find((r) => r.email === 'ana@firstblades.test' && r.fecha === '2026-02-28');
    expect(anaVacio?.estado).toBeNull();
  });

  it('días asignados: etiquetas es-AR (no el valor del enum) y textos libres', () => {
    const rows = dataRows();
    const find = (email: string, fecha: string) => rows.find((r) => r.email === email && r.fecha === fecha)!;

    expect(find('ana@firstblades.test', '2026-02-27')).toMatchObject({ estado: 'Trabajando', motivo: null });
    expect(find('ana@firstblades.test', '2026-03-01')).toMatchObject({ estado: 'En franco', notas: 'franco largo' });
    expect(find('beto@firstblades.test', '2026-03-01')).toMatchObject({ estado: 'En viaje' });
    expect(find('beto@firstblades.test', '2026-02-28')).toMatchObject({
      estado: 'Fuera del trabajo',
      motivo: 'Otros',
      motivo_otros: 'mudanza',
    });
    expect(find('beto@firstblades.test', '2026-03-02')).toMatchObject({
      estado: 'Fuera del trabajo',
      motivo: 'Día de trámite',
    });
  });

  it('una asignación fuera del rango no aparece', () => {
    expect(dataRows().some((r) => r.fecha === '2026-03-05')).toBe(false);
  });

  it('fecha se guarda como texto AAAA-MM-DD, no como fecha de Excel', () => {
    const cell = sheet.getRow(2).getCell(3);
    expect(typeof cell.value).toBe('string');
    expect(cell.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cell.numFmt).toBe('@');
  });

  it('sin empleados: solo la fila de encabezados', async () => {
    const buffer = await buildCalendarioWorkbook({ employees: [], assignments: [] }, DESDE, HASTA);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as XlsxInput);
    expect(wb.getWorksheet(copy.calendario.excel.hojas.calendario)!.rowCount).toBe(1);
  });
});

describe('hoja Calendario: desplegables y bloqueo', () => {
  const COL = Object.fromEntries(CALENDARIO_EXCEL_COLUMNS.map((c, i) => [c.key, i + 1]));

  it('cada celda de estado lleva desplegable con los 4 estados (vacío permitido)', () => {
    for (let r = 2; r <= sheet.rowCount; r++) {
      const dv = sheet.getRow(r).getCell(COL.estado).dataValidation;
      expect(dv?.type).toBe('list');
      expect(dv?.allowBlank).toBe(true);
      expect(dv?.formulae).toEqual(['"Trabajando,En franco,En viaje,Fuera del trabajo"']);
    }
  });

  it('cada celda de motivo lleva desplegable con los 6 motivos (vacío permitido)', () => {
    for (let r = 2; r <= sheet.rowCount; r++) {
      const dv = sheet.getRow(r).getCell(COL.motivo).dataValidation;
      expect(dv?.type).toBe('list');
      expect(dv?.allowBlank).toBe(true);
      expect(dv?.formulae).toEqual([
        '"Vacaciones,Licencia médica,Día de trámite,Matrimonio,Fallecimiento,Otros"',
      ]);
    }
  });

  it('email, nombre y fecha bloqueadas; estado, motivo, motivo_otros y notas editables', () => {
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      // OOXML: sin <protection locked="0"> la celda está bloqueada (default).
      for (const key of ['email', 'nombre', 'fecha']) {
        expect(row.getCell(COL[key]).protection?.locked, `${key} fila ${r}`).not.toBe(false);
      }
      for (const key of ['estado', 'motivo', 'motivo_otros', 'notas']) {
        expect(row.getCell(COL[key]).protection?.locked, `${key} fila ${r}`).toBe(false);
      }
    }
  });

  it('la hoja está protegida (sin eso el bloqueo de celdas no tiene efecto)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protection = (sheet as any).sheetProtection;
    expect(protection?.sheet).toBe(true);
  });
});

describe('textos del archivo: nombran el estado con la etiqueta de la app', () => {
  it('el mensaje de error del motivo y la nota de Referencia dicen "Fuera del trabajo"', () => {
    const esperado = `"${copy.status.periodo_fuera_trabajo}"`;
    const dv = sheet.getRow(2).getCell(5).dataValidation;
    expect(dv?.error).toContain(esperado);

    const ref = workbook.getWorksheet(copy.calendario.excel.hojas.referencia)!;
    const textos: string[] = [];
    ref.eachRow((row) => textos.push(String(row.getCell(1).value ?? '')));
    expect(textos.some((t) => t.includes(esperado))).toBe(true);
  });

  it('ninguna celda ni validación del archivo menciona otra etiqueta para ese estado', async () => {
    const buffer = await buildCalendarioWorkbook(DATA, DESDE, HASTA);
    // Todas las celdas, mensajes y listas de validación de las dos hojas.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as XlsxInput);
    const todo: string[] = [];
    wb.eachSheet((ws) => {
      ws.eachRow((row) => row.eachCell((cell) => {
        todo.push(String(cell.value ?? ''));
        if (cell.dataValidation?.error) todo.push(cell.dataValidation.error);
        for (const f of cell.dataValidation?.formulae ?? []) todo.push(String(f));
      }));
    });
    expect(todo.filter((t) => /per[ií]odo fuera/i.test(t))).toEqual([]);
  });
});

describe('hoja Referencia', () => {
  it('existe y lista todas las combinaciones válidas de estado y motivo', () => {
    const ref = workbook.getWorksheet(copy.calendario.excel.hojas.referencia)!;
    expect(ref).toBeDefined();

    const combos: [string | null, string | null][] = [];
    ref.eachRow((row, n) => {
      if (n === 1) return;
      combos.push([text(row.getCell(1)), text(row.getCell(2))]);
    });

    const vacio = copy.calendario.excel.referencia.vacio;
    const esperadas: [string, string][] = [
      [vacio, vacio],
      ['Trabajando', vacio],
      ['En franco', vacio],
      ['En viaje', vacio],
      ['Fuera del trabajo', 'Vacaciones'],
      ['Fuera del trabajo', 'Licencia médica'],
      ['Fuera del trabajo', 'Día de trámite'],
      ['Fuera del trabajo', 'Matrimonio'],
      ['Fuera del trabajo', 'Fallecimiento'],
      ['Fuera del trabajo', 'Otros'],
    ];
    for (const combo of esperadas) {
      expect(combos).toContainEqual(combo);
    }
  });
});
