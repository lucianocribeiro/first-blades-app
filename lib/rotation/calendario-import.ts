// FB-PI-11 — Import del calendario desde Excel (admin): parseo, validación,
// plan y saldo. Funciones puras: la lectura de la base vive en
// calendario-import-data.ts y la escritura en la RPC importar_calendario
// (migración 0022), que vuelve a validar y recalcula todo dentro de la
// transacción.
//
// Reusa el formato del export (FB-PI-04), no lo reescribe: columnas
// (CALENDARIO_EXCEL_COLUMNS), mapeo etiqueta↔enum (calendario-excel-mapping),
// y validador de fecha y de rango con su tope de 366 días (validarRangoExport).
//
// IMPORTANTE — nada de lo que diga el archivo se toma como válido por haber
// salido del export: el desplegable de Excel no es un control (se puede
// pegar texto encima). Toda la validación corre acá, server-side, y otra vez
// en la base.
//
// Espejo con la RPC: normalizarEmail(), normalizarTexto() y la clasificación
// de calcularPlanImport() replican exactamente el criterio de 0022. Si uno
// cambia, cambia el otro (los conteos se comparan entre los dos lados).
import ExcelJS from 'exceljs';
import { copy } from '@/lib/copy';
import { getBusinessToday } from '@/lib/business-date';
import { normalizarEmail } from '@/lib/normalizar-email';
import type { EmployeeStatus, EstadoDia, MotivoAusencia, PostAprobacionTipo, UserRole } from '@/lib/db-types';
import { CALENDARIO_EXCEL_COLUMNS, type CalendarioExcelColumnKey } from './calendario-excel';
import {
  ESTADO_CON_MOTIVO,
  MOTIVO_CON_DETALLE,
  excelLabelToEstado,
  excelLabelToMotivo,
} from './calendario-excel-mapping';
import { validarRangoExport } from './calendario-export';
import { computeSaldoDiasTramite, getYearRange, TOPE_DIAS_TRAMITE_ANUAL } from './saldo-dias-tramite';

const E = copy.calendario.excel.importar.errores;

// Mismo tope que la columna (VARCHAR(80)) y que el export.
const MOTIVO_OTROS_MAX = 80;

// Ventana razonable de fechas (INSPECT §9, D6): nada antes de 2020 ni más de
// dos años hacia adelante.
export const FECHA_MIN_IMPORT = '2020-01-01';
const ANIOS_FUTURO_IMPORT = 2;

// Tope de filas de datos que se procesan de un archivo. Por encima, es un
// archivo que no salió del export (366 días × la nómina actual queda muy por
// debajo) y no vale la pena leerlo.
export const MAX_FILAS_IMPORT = 50_000;

// ─── Normalización (espejo de 0022) ──────────────────────────────────────

// Clave del índice profiles_email_normalizado_unique, lower(btrim(email)):
// la misma función que usa el alta de usuarios (lib/normalizar-email.ts).
export { normalizarEmail };

// btrim + vacío = NULL, igual que NULLIF(btrim(x), '') en la RPC.
export function normalizarTexto(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Parseo del .xlsx ────────────────────────────────────────────────────

export type ImportRawRow = {
  fila: number; // número de fila en Excel (la 1 es el encabezado)
  email: string | null;
  fecha: string | null;
  estado: string | null;
  motivo: string | null;
  motivo_otros: string | null;
  notas: string | null;
};

export type ParseResult =
  | { ok: true; rows: ImportRawRow[] }
  | { ok: false; error: string };

type Cell = ExcelJS.CellValue | undefined;

// Texto de una celda, cualquiera sea la forma en que exceljs la entregue:
// Excel convierte un email tipeado en hipervínculo, un texto con formato
// mixto es richText, una fórmula trae su resultado.
export function cellToText(value: Cell): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('hyperlink' in value && 'text' in value) return cellToText(value.text as Cell);
    if ('result' in value) return cellToText(value.result as Cell);
    if ('error' in value) return String(value.error);
  }
  return null;
}

// Excel guarda las fechas como número de días desde 1899-12-30 (serial). Si
// alguien reescribió la celda y Excel o Sheets la convirtieron a su formato
// interno, exceljs devuelve un Date (celda con formato de fecha) o el serial
// crudo (formato general). Las dos se aceptan y se normalizan a AAAA-MM-DD
// (decisión 6). Un texto se deja como está: lo valida isValidIsoDate.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function cellToFecha(value: Cell): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 2_958_465) return String(value);
    return new Date(EXCEL_EPOCH_MS + value * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && value !== null && 'result' in value) {
    return cellToFecha(value.result as Cell);
  }
  return cellToText(value);
}

type XlsxInput = Parameters<ExcelJS.Xlsx['load']>[0];

export async function parseCalendarioWorkbook(buffer: ArrayBuffer | Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as XlsxInput);
  } catch {
    return { ok: false, error: E.archivoIlegible };
  }

  const sheet = workbook.getWorksheet(copy.calendario.excel.hojas.calendario);
  if (!sheet) return { ok: false, error: E.sinHoja };

  // Columnas por ENCABEZADO, no por posición: el admin puede haber movido o
  // agregado columnas.
  const header = sheet.getRow(1);
  const colIndex = new Map<CalendarioExcelColumnKey, number>();
  header.eachCell((cell, col) => {
    const text = cellToText(cell.value)?.trim().toLowerCase();
    const match = CALENDARIO_EXCEL_COLUMNS.find((c) => c.header.toLowerCase() === text);
    if (match && !colIndex.has(match.key)) colIndex.set(match.key, col);
  });
  const faltantes = CALENDARIO_EXCEL_COLUMNS.filter((c) => !colIndex.has(c.key)).map((c) => c.header);
  if (faltantes.length > 0) return { ok: false, error: `${E.columnasFaltantes} ${faltantes.join(', ')}.` };

  if (sheet.rowCount - 1 > MAX_FILAS_IMPORT) return { ok: false, error: E.demasiadasFilas };

  const rows: ImportRawRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (key: CalendarioExcelColumnKey) => row.getCell(colIndex.get(key)!).value;
    const raw: ImportRawRow = {
      fila: r,
      email: cellToText(get('email')),
      fecha: cellToFecha(get('fecha')),
      estado: cellToText(get('estado')),
      motivo: cellToText(get('motivo')),
      motivo_otros: cellToText(get('motivo_otros')),
      notas: cellToText(get('notas')),
    };
    // Filas totalmente vacías (p. ej. formato arrastrado al final): se
    // ignoran. `nombre` no se lee: es solo para que el admin se ubique.
    const vacia = [raw.email, raw.fecha, raw.estado, raw.motivo, raw.motivo_otros, raw.notas].every(
      (v) => normalizarTexto(v) === null
    );
    if (!vacia) rows.push(raw);
  }

  if (rows.length === 0) return { ok: false, error: E.sinFilas };
  return { ok: true, rows };
}

// ─── Validación ──────────────────────────────────────────────────────────

export type ImportProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  status: EmployeeStatus;
};

export type ImportRow = {
  fila: number;
  user_id: string;
  email: string; // normalizado
  nombre: string | null;
  fecha: string;
  estado_dia: EstadoDia | null; // null = borrar el día
  motivo_ausencia: MotivoAusencia | null;
  motivo_otros_texto: string | null;
  notas: string | null;
};

// fila null = error del archivo en conjunto (p. ej. el rango).
export type ImportError = { fila: number | null; mensaje: string };

export type ValidacionImport = {
  filas: ImportRow[];
  errores: ImportError[];
  desde: string | null;
  hasta: string | null;
};

// Igual que (fecha + INTERVAL 'n years')::date en Postgres (límite que
// revalida la RPC): un 29/02 que cae en año no bisiesto pasa a 28/02.
export function sumarAnios(fecha: string, anios: number): string {
  const y = Number(fecha.slice(0, 4)) + anios;
  const md = fecha.slice(5);
  const bisiesto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === '02-29' && !bisiesto ? '02-28' : md}`;
}

export function validarFilasImport(
  rows: ImportRawRow[],
  profiles: ImportProfile[],
  today: string = getBusinessToday()
): ValidacionImport {
  const errores: ImportError[] = [];
  const filas: ImportRow[] = [];

  const porEmail = new Map<string, ImportProfile[]>();
  for (const p of profiles) {
    const key = normalizarEmail(p.email);
    porEmail.set(key, [...(porEmail.get(key) ?? []), p]);
  }

  const fechaMax = sumarAnios(today, ANIOS_FUTURO_IMPORT);
  const vistos = new Map<string, number[]>();

  for (const raw of rows) {
    const errs: string[] = [];

    // Email: existe, es único y está en el alcance del export (decisión 2).
    // Dos pasos distintos: normalizarTexto limpia la CELDA (Excel puede
    // dejar tabs o saltos de línea al pegar); normalizarEmail produce la
    // clave del índice, la misma con la que se indexan los perfiles arriba.
    const emailTexto = normalizarTexto(raw.email);
    let profile: ImportProfile | null = null;
    if (!emailTexto) {
      errs.push(E.emailVacio);
    } else {
      const matches = porEmail.get(normalizarEmail(emailTexto)) ?? [];
      if (matches.length === 0) errs.push(E.emailInexistente);
      else if (matches.length > 1) errs.push(E.emailAmbiguo);
      else if (matches[0].role === 'admin') errs.push(E.emailAdmin);
      else if (matches[0].status !== 'activo') errs.push(E.emailInactivo);
      else profile = matches[0];
    }

    // Fecha: ISO válida (texto o convertida desde el formato de Excel) y
    // dentro de la ventana razonable.
    const fecha = normalizarTexto(raw.fecha);
    let fechaOk: string | null = null;
    if (!fecha) {
      errs.push(E.fechaVacia);
    } else if (validarRangoExport(fecha, fecha) !== null) {
      errs.push(E.fechaInvalida);
    } else if (fecha < FECHA_MIN_IMPORT || fecha > fechaMax) {
      errs.push(`${E.fechaFueraDeVentana} ${FECHA_MIN_IMPORT} ${E.y} ${fechaMax}.`);
    } else {
      fechaOk = fecha;
    }

    // Estado, motivo, detalle y notas, vía el mapeo compartido.
    const estadoTexto = normalizarTexto(raw.estado);
    const motivoTexto = normalizarTexto(raw.motivo);
    const motivoOtros = normalizarTexto(raw.motivo_otros);
    const notas = normalizarTexto(raw.notas);

    const estado = estadoTexto ? excelLabelToEstado(estadoTexto) : null;
    if (estadoTexto && !estado) errs.push(`${E.estadoInvalido} "${estadoTexto}".`);

    const motivo = motivoTexto ? excelLabelToMotivo(motivoTexto) : null;
    if (motivoTexto && !motivo) errs.push(`${E.motivoInvalido} "${motivoTexto}".`);

    if (!estadoTexto) {
      // Celda de estado vacía = borrar el día: no puede venir con datos.
      if (motivoTexto || motivoOtros) errs.push(E.motivoSinEstado);
      if (notas) errs.push(E.notasSinEstado);
    } else if (estado === ESTADO_CON_MOTIVO) {
      if (!motivoTexto) errs.push(E.motivoObligatorio);
    } else if (estado && motivoTexto) {
      errs.push(E.motivoNoCorresponde);
    }

    if (motivo === MOTIVO_CON_DETALLE && !motivoOtros) errs.push(E.detalleObligatorio);
    if (motivo !== MOTIVO_CON_DETALLE && motivoOtros && estadoTexto) errs.push(E.detalleNoCorresponde);
    if (motivoOtros && motivoOtros.length > MOTIVO_OTROS_MAX) errs.push(E.detalleLargo);

    if (profile && fechaOk) {
      const key = `${profile.id}|${fechaOk}`;
      vistos.set(key, [...(vistos.get(key) ?? []), raw.fila]);
    }

    if (errs.length > 0) {
      for (const mensaje of errs) errores.push({ fila: raw.fila, mensaje });
      continue;
    }

    filas.push({
      fila: raw.fila,
      user_id: profile!.id,
      email: normalizarEmail(profile!.email),
      nombre: profile!.full_name,
      fecha: fechaOk!,
      estado_dia: estado,
      motivo_ausencia: estado === ESTADO_CON_MOTIVO ? motivo : null,
      motivo_otros_texto: motivo === MOTIVO_CON_DETALLE ? motivoOtros : null,
      notas: estado ? notas : null,
    });
  }

  // Fila duplicada (mismo empleado y día): error en todas las apariciones.
  for (const filasDup of vistos.values()) {
    if (filasDup.length < 2) continue;
    for (const fila of filasDup) {
      errores.push({ fila, mensaje: `${E.duplicada} ${filasDup.filter((f) => f !== fila).join(', ')}.` });
    }
  }

  // Rango del archivo: de la fecha más temprana a la más tardía, tope 366.
  const fechas = rows
    .map((r) => normalizarTexto(r.fecha))
    .filter((f): f is string => f !== null && validarRangoExport(f, f) === null)
    .sort();
  const desde = fechas[0] ?? null;
  const hasta = fechas[fechas.length - 1] ?? null;
  if (desde && hasta && validarRangoExport(desde, hasta) !== null) {
    errores.push({ fila: null, mensaje: `${E.rangoExcedido} (${desde} ${E.a} ${hasta}).` });
  }

  errores.sort((a, b) => (a.fila ?? 0) - (b.fila ?? 0));
  return { filas: errores.length > 0 ? [] : filas, errores, desde, hasta };
}

// ─── Plan (espejo de la clasificación de 0022) ───────────────────────────

export type CurrentAssignment = {
  id: string;
  user_id: string;
  fecha: string;
  estado_dia: EstadoDia;
  motivo_ausencia: MotivoAusencia | null;
  motivo_otros_texto: string | null;
  notas: string | null;
  es_estimado: boolean;
};

export type ApprovedAusencia = {
  id: string;
  user_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  post_aprobacion_tipo: PostAprobacionTipo | null;
};

export type ApprovedPasaje = {
  id: string;
  empleado_id: string;
  dias_viaje: string[] | null;
  post_aprobacion_tipo: PostAprobacionTipo | null;
};

export type Cobertura = { tipo: 'ausencia' | 'pasaje'; id: string };

export type AccionImport = 'crear' | 'modificar' | 'borrar' | 'sin_cambios';

export type PlanRow = ImportRow & {
  accion: AccionImport;
  actual: CurrentAssignment | null;
  solicitudes: Cobertura[]; // aprobadas y no canceladas que cubren el día
  pisado: boolean;
};

export type ImportConteos = {
  crear: number;
  modificar: number;
  borrar: number;
  sin_cambios: number;
  pisados: number;
};

export type PlanImport = { filas: PlanRow[]; conteos: ImportConteos };

// Misma condición que 0017/0022: ausencia por rango, pasaje por fecha
// discreta en dias_viaje; aprobada y no cancelada (las consultas ya traen
// solo las aprobadas).
function coberturas(
  userId: string,
  fecha: string,
  ausencias: ApprovedAusencia[],
  pasajes: ApprovedPasaje[]
): Cobertura[] {
  const out: Cobertura[] = [];
  for (const a of ausencias) {
    if (a.user_id === userId && a.post_aprobacion_tipo !== 'cancelada' && fecha >= a.fecha_inicio && fecha <= a.fecha_fin) {
      out.push({ tipo: 'ausencia', id: a.id });
    }
  }
  for (const p of pasajes) {
    if (p.empleado_id === userId && p.post_aprobacion_tipo !== 'cancelada' && (p.dias_viaje ?? []).includes(fecha)) {
      out.push({ tipo: 'pasaje', id: p.id });
    }
  }
  return out;
}

// Comparación sobre los campos editables, con los valores de la base TAL
// CUAL (sin normalizar) contra los del archivo ya normalizados — igual que
// el IS NOT DISTINCT FROM de la RPC.
function sinCambios(actual: CurrentAssignment, fila: ImportRow): boolean {
  return (
    actual.estado_dia === fila.estado_dia &&
    actual.motivo_ausencia === fila.motivo_ausencia &&
    actual.motivo_otros_texto === fila.motivo_otros_texto &&
    actual.notas === fila.notas
  );
}

export function calcularPlanImport(
  filas: ImportRow[],
  actuales: CurrentAssignment[],
  ausencias: ApprovedAusencia[],
  pasajes: ApprovedPasaje[]
): PlanImport {
  const porClave = new Map(actuales.map((a) => [`${a.user_id}|${a.fecha}`, a]));
  const conteos: ImportConteos = { crear: 0, modificar: 0, borrar: 0, sin_cambios: 0, pisados: 0 };

  const plan = filas.map((fila): PlanRow => {
    const actual = porClave.get(`${fila.user_id}|${fila.fecha}`) ?? null;
    let accion: AccionImport;
    if (fila.estado_dia === null) accion = actual ? 'borrar' : 'sin_cambios';
    else if (!actual) accion = 'crear';
    else accion = sinCambios(actual, fila) ? 'sin_cambios' : 'modificar';

    const solicitudes = coberturas(fila.user_id, fila.fecha, ausencias, pasajes);
    const pisado = (accion === 'modificar' || accion === 'borrar') && solicitudes.length > 0;

    conteos[accion]++;
    if (pisado) conteos.pisados++;
    return { ...fila, accion, actual, solicitudes, pisado };
  });

  return { filas: plan, conteos };
}

// ─── Impacto en el saldo de días de trámite ──────────────────────────────

export type DiaTramiteActual = { user_id: string; fecha: string };

export type ImpactoSaldo = {
  employeeId: string;
  nombre: string | null;
  email: string;
  anio: string;
  antes: number;
  despues: number;
  tope: number;
  excedido: boolean;
};

// El saldo se deriva del calendario por año calendario
// (saldo-dias-tramite.ts): importar días de trámite lo consume
// retroactivamente. Se calcula el "después" aplicando el plan sobre los días
// de trámite actuales de los años que toca el archivo, con la misma función
// que usa el panel de saldo. Solo se listan los empleados-año que cambian o
// quedan excedidos.
export function calcularImpactoSaldo(plan: PlanRow[], diasTramite: DiaTramiteActual[]): ImpactoSaldo[] {
  const empleados = new Map<string, { nombre: string | null; email: string }>();
  const anios = new Map<string, Set<string>>(); // user_id → años que toca el archivo
  for (const fila of plan) {
    empleados.set(fila.user_id, { nombre: fila.nombre, email: fila.email });
    const set = anios.get(fila.user_id) ?? new Set<string>();
    set.add(fila.fecha.slice(0, 4));
    anios.set(fila.user_id, set);
  }

  const antes = new Set(diasTramite.map((d) => `${d.user_id}|${d.fecha}`));
  const despues = new Set(antes);
  for (const fila of plan) {
    const key = `${fila.user_id}|${fila.fecha}`;
    despues.delete(key);
    if (fila.estado_dia !== null && fila.motivo_ausencia === 'dia_tramite') despues.add(key);
  }

  const contar = (set: Set<string>, userId: string, anio: string) => {
    const { start, end } = getYearRange(`${anio}-01-01`);
    return [...set].filter((k) => {
      const [u, f] = k.split('|');
      return u === userId && f >= start && f <= end;
    });
  };

  const out: ImpactoSaldo[] = [];
  for (const [userId, set] of anios) {
    const emp = empleados.get(userId)!;
    for (const anio of [...set].sort()) {
      const nAntes = contar(antes, userId, anio).length;
      const diasDespues = contar(despues, userId, anio).map((k) => ({
        user_id: userId,
        fecha: k.split('|')[1],
        es_estimado: false,
      }));
      const [saldo] = computeSaldoDiasTramite([{ id: userId, full_name: emp.nombre, email: emp.email }], diasDespues);
      if (saldo.consumidos === nAntes && !saldo.excedido) continue;
      out.push({
        employeeId: userId,
        nombre: emp.nombre,
        email: emp.email,
        anio,
        antes: nAntes,
        despues: saldo.consumidos,
        tope: TOPE_DIAS_TRAMITE_ANUAL,
        excedido: saldo.excedido,
      });
    }
  }
  return out.sort((a, b) => (a.nombre ?? a.email).localeCompare(b.nombre ?? b.email, 'es') || a.anio.localeCompare(b.anio));
}

// ─── Lote para la RPC ────────────────────────────────────────────────────

export type FilaRpc = {
  email: string;
  fecha: string;
  estado_dia: EstadoDia | null;
  motivo_ausencia: MotivoAusencia | null;
  motivo_otros_texto: string | null;
  notas: string | null;
};

// Todas las filas del archivo (también las sin cambios): la RPC cuenta
// sin_cambios y lo compara con lo que vio el admin.
export function filasParaRpc(filas: ImportRow[]): FilaRpc[] {
  return filas.map((f) => ({
    email: f.email,
    fecha: f.fecha,
    estado_dia: f.estado_dia,
    motivo_ausencia: f.motivo_ausencia,
    motivo_otros_texto: f.motivo_otros_texto,
    notas: f.notas,
  }));
}

export function mismosConteos(a: ImportConteos, b: ImportConteos): boolean {
  return (
    a.crear === b.crear &&
    a.modificar === b.modificar &&
    a.borrar === b.borrar &&
    a.sin_cambios === b.sin_cambios &&
    a.pisados === b.pisados
  );
}
