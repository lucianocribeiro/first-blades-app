// FB-PI-04 — Generación del .xlsx del calendario (export, admin).
//
// Hoja "Calendario": una fila por empleado activo × día del rango, incluidos
// los días sin asignación (estado vacío): sobre un calendario vacío, el
// archivo es la grilla a completar (PRD §3). Orden: nombre, después fecha.
// Hoja "Referencia": combinaciones válidas de estado y motivo.
//
// IMPORTANTE — los desplegables y el bloqueo de celdas son COMODIDAD, NO UN
// CONTROL. Cualquiera puede pegar texto sobre una celda validada (Excel lo
// acepta) o desproteger la hoja (no lleva contraseña). La validación real de
// cada fila corre server-side en el import (FB-PI-05); nada de lo que diga
// este archivo se toma como válido por haber salido de acá.
import ExcelJS from 'exceljs';
import { copy } from '@/lib/copy';
import type { CalendarioExportData, ExportAssignment } from './calendario-export';
import {
  ESTADOS_EXCEL,
  MOTIVOS_EXCEL,
  ESTADO_CON_MOTIVO,
  MOTIVO_CON_DETALLE,
  estadoToExcelLabel,
  motivoToExcelLabel,
} from './calendario-excel-mapping';

const COLS = copy.calendario.excel.columnas;

// Orden fijo de columnas (PRD §3). Las tres primeras quedan bloqueadas.
export const CALENDARIO_EXCEL_COLUMNS = [
  { key: 'email',        header: COLS.email,        width: 32, editable: false },
  { key: 'nombre',       header: COLS.nombre,       width: 28, editable: false },
  { key: 'fecha',        header: COLS.fecha,        width: 12, editable: false },
  { key: 'estado',       header: COLS.estado,       width: 26, editable: true },
  { key: 'motivo',       header: COLS.motivo,       width: 18, editable: true },
  { key: 'motivo_otros', header: COLS.motivo_otros, width: 30, editable: true },
  { key: 'notas',        header: COLS.notas,        width: 40, editable: true },
] as const;

export type CalendarioExcelColumnKey = (typeof CALENDARIO_EXCEL_COLUMNS)[number]['key'];

// Mismo tope que la columna en la base (VARCHAR(80), migración 0009).
const MOTIVO_OTROS_MAX = 80;

// Lista inline para la validación: `"A,B,C"`. Excel limita la fórmula a 255
// caracteres y usa la coma como separador — el test de mapeo verifica ambas
// cosas sobre las etiquetas.
export function listFormula(labels: string[]): string {
  return `"${labels.join(',')}"`;
}

export function getExportDays(desde: string, hasta: string): string[] {
  const [ay, am, ad] = desde.split('-').map(Number);
  const [by, bm, bd] = hasta.split('-').map(Number);
  const end = Date.UTC(by, bm - 1, bd);
  const days: string[] = [];
  for (let ms = Date.UTC(ay, am - 1, ad); ms <= end; ms += 86_400_000) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

export function exportFilename(desde: string, hasta: string): string {
  return `calendario_${desde}_a_${hasta}.xlsx`;
}

function addCalendarioSheet(workbook: ExcelJS.Workbook, data: CalendarioExportData, days: string[]) {
  const sheet = workbook.addWorksheet(copy.calendario.excel.hojas.calendario, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = CALENDARIO_EXCEL_COLUMNS.map(({ key, header, width }) => ({ key, header, width }));
  sheet.getRow(1).font = { bold: true };

  const byKey = new Map<string, ExportAssignment>();
  for (const a of data.assignments) byKey.set(`${a.user_id}|${a.fecha}`, a);

  const estadoList = listFormula(ESTADOS_EXCEL.map(estadoToExcelLabel));
  const motivoList = listFormula(MOTIVOS_EXCEL.map(motivoToExcelLabel));
  const v = copy.calendario.excel.validacion;

  // data.employees ya viene ordenado por nombre (y email como desempate).
  for (const emp of data.employees) {
    for (const fecha of days) {
      const a = byKey.get(`${emp.id}|${fecha}`);
      const row = sheet.addRow({
        email: emp.email,
        nombre: emp.full_name,
        fecha,
        estado: a ? estadoToExcelLabel(a.estado_dia) : null,
        motivo: a?.motivo_ausencia ? motivoToExcelLabel(a.motivo_ausencia) : null,
        motivo_otros: a?.motivo_otros_texto ?? null,
        notas: a?.notas ?? null,
      });

      // fecha como TEXTO (no fecha de Excel): así se lee igual en cualquier
      // locale y vuelve intacta al import.
      row.getCell('fecha').numFmt = '@';

      // En OOXML toda celda está bloqueada por defecto (y exceljs no
      // serializa locked:true): solo hay que destrabar las editables.
      for (const col of CALENDARIO_EXCEL_COLUMNS) {
        if (col.editable) row.getCell(col.key).protection = { locked: false };
      }

      // Comodidad, no control (ver cabecera del archivo).
      row.getCell('estado').dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [estadoList],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: v.estadoTitulo,
        error: v.estadoMensaje,
      };
      row.getCell('motivo').dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [motivoList],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: v.motivoTitulo,
        error: v.motivoMensaje,
      };
      row.getCell('motivo_otros').dataValidation = {
        type: 'textLength',
        operator: 'lessThanOrEqual',
        allowBlank: true,
        formulae: [MOTIVO_OTROS_MAX],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: v.motivoOtrosTitulo,
        error: v.motivoOtrosMensaje,
      };
    }
  }

  if (sheet.rowCount > 1) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: CALENDARIO_EXCEL_COLUMNS.length } };
  }

  return sheet;
}

function addReferenciaSheet(workbook: ExcelJS.Workbook) {
  const r = copy.calendario.excel.referencia;
  const sheet = workbook.addWorksheet(copy.calendario.excel.hojas.referencia);
  sheet.columns = [
    { header: r.encabezados.estado, key: 'estado', width: 28 },
    { header: r.encabezados.motivo, key: 'motivo', width: 20 },
    { header: r.encabezados.motivoOtros, key: 'motivoOtros', width: 34 },
    { header: r.encabezados.significado, key: 'significado', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  sheet.addRow({ estado: r.vacio, motivo: r.vacio, motivoOtros: r.noCorresponde, significado: r.sinAsignar });
  for (const estado of ESTADOS_EXCEL) {
    if (estado === ESTADO_CON_MOTIVO) {
      for (const motivo of MOTIVOS_EXCEL) {
        sheet.addRow({
          estado: estadoToExcelLabel(estado),
          motivo: motivoToExcelLabel(motivo),
          motivoOtros: motivo === MOTIVO_CON_DETALLE ? r.obligatorio : r.noCorresponde,
          significado: r.ausenciaPorMotivo,
        });
      }
    } else {
      sheet.addRow({
        estado: estadoToExcelLabel(estado),
        motivo: r.vacio,
        motivoOtros: r.noCorresponde,
        significado: r.diaAsignado,
      });
    }
  }

  sheet.addRow({});
  for (const nota of r.notas) sheet.addRow({ estado: nota });

  return sheet;
}

export async function buildCalendarioWorkbook(
  data: CalendarioExportData,
  desde: string,
  hasta: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Portal First Blades';
  workbook.created = new Date();

  const calendario = addCalendarioSheet(workbook, data, getExportDays(desde, hasta));
  const referencia = addReferenciaSheet(workbook);

  // Protección SIN contraseña: evita ediciones accidentales de email/nombre/
  // fecha, no es seguridad (ver cabecera). Se deja usar filtros y ajustar
  // columnas para que el archivo siga siendo cómodo de recorrer.
  const options = {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    formatColumns: true,
  };
  await calendario.protect('', options);
  await referencia.protect('', options);

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
