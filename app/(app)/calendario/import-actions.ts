'use server';

// FB-PI-11 — Import del calendario desde Excel (solo admin).
//
// Flujo en dos pasos, y el segundo no existe sin el primero (PRD §4):
//   1. previsualizarImportCalendario(file): parsea, valida y calcula el plan
//      contra el calendario actual. NO escribe nada. Devuelve los conteos,
//      los días que se borran, los que pisan solicitudes aprobadas, el
//      impacto en el saldo de días de trámite y los errores.
//   2. confirmarImportCalendario(file + hash + conteos vistos): vuelve a
//      parsear y validar el MISMO archivo (no confía en nada que mande el
//      cliente salvo para compararlo) y llama a la RPC importar_calendario,
//      que recalcula todo dentro de la transacción y aborta si los conteos
//      no coinciden con los que vio el admin (decisión 1, FB-PI-11-B).
//
// Contratos (constitución §2.5):
// - Guard de rol: requireAdmin() corta por redirect() ANTES de leer el
//   archivo o la base (excepción FB-F5-AUD-05) — no devuelve { ok }.
// - Errores de negocio de una llamada ya autorizada: { ok: false, error }
//   con copy es-AR. El { error } de PostgREST se lee como valor.
// - Cliente de sesión (createServerClient), NUNCA createAdminClient:
//   service_role no tiene `sub` en el JWT y la guarda auth.uid() de la RPC
//   abortaría siempre; además las lecturas pasan por RLS.
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { EstadoDia } from '@/lib/db-types';
import {
  calcularImpactoSaldo,
  calcularPlanImport,
  filasParaRpc,
  mismosConteos,
  parseCalendarioWorkbook,
  validarFilasImport,
  type Cobertura,
  type ImpactoSaldo,
  type ImportConteos,
  type ImportError,
  type ImportRow,
} from '@/lib/rotation/calendario-import';
import { fetchImportContext, fetchImportProfiles } from '@/lib/rotation/calendario-import-data';

const E = copy.calendario.excel.importar.errores;

// El límite de body de una Server Action es 1 MB (default de Next 15, no se
// toca): un año entero de la nómina actual pesa ~216 KB (INSPECT §6).
const MAX_IMPORT_BYTES = 1_000_000;

// Topes de lo que viaja a la pantalla. Los conteos son siempre completos.
const MAX_ERRORES_PREVIEW = 200;
const MAX_LISTA_PREVIEW = 500;

export type DiaPreview = {
  fila: number;
  nombre: string;
  fecha: string;
  actual: EstadoDia | null;
  nuevo: EstadoDia | null; // null = se borra
  solicitudes: Cobertura[];
};

export type PrevisualizacionImport = {
  archivo: { nombre: string; hash: string };
  desde: string | null;
  hasta: string | null;
  totalFilas: number;
  errores: ImportError[];
  erroresTotal: number;
  // null cuando hay errores: sin plan no hay qué confirmar.
  conteos: ImportConteos | null;
  borrados: DiaPreview[];
  pisados: DiaPreview[];
  saldo: ImpactoSaldo[];
};

export type PrevisualizarImportResult =
  | { ok: true; preview: PrevisualizacionImport }
  | { ok: false; error: string };

export type ResultadoImport = {
  creadas: number;
  modificadas: number;
  borradas: number;
  sin_cambios: number;
  pisadas: number;
};

export type ConfirmarImportResult =
  | { ok: true; resultado: ResultadoImport }
  // desactualizado: la previsualización ya no vale, hay que repetirla.
  | { ok: false; error: string; desactualizado?: boolean };

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

type Preparado =
  | { ok: false; error: string }
  | {
      ok: true;
      hash: string;
      preview: PrevisualizacionImport;
      filas: ImportRow[];
    };

// File-like por forma, no por `instanceof File`: la clase File del runtime
// de la action no tiene por qué ser la misma global que la del llamador.
type ArchivoSubido = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

function esArchivo(value: unknown): value is ArchivoSubido {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ArchivoSubido).name === 'string' &&
    typeof (value as ArchivoSubido).size === 'number' &&
    typeof (value as ArchivoSubido).arrayBuffer === 'function'
  );
}

async function leerArchivo(file: unknown): Promise<{ ok: true; bytes: Buffer; nombre: string } | { ok: false; error: string }> {
  if (!esArchivo(file) || file.size === 0) return { ok: false, error: E.archivoRequerido };
  if (!file.name.toLowerCase().endsWith('.xlsx')) return { ok: false, error: E.archivoTipo };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: E.archivoGrande };
  return { ok: true, bytes: Buffer.from(await file.arrayBuffer()), nombre: file.name };
}

function aDiaPreview(fila: ImportRow & { actual: { estado_dia: EstadoDia } | null; solicitudes: Cobertura[] }): DiaPreview {
  return {
    fila: fila.fila,
    nombre: fila.nombre || fila.email,
    fecha: fila.fecha,
    actual: fila.actual?.estado_dia ?? null,
    nuevo: fila.estado_dia,
    solicitudes: fila.solicitudes,
  };
}

// Paso común a previsualizar y confirmar: mismo parseo, misma validación,
// mismo plan. Nada de esto escribe.
async function prepararImport(supabase: Supabase, file: unknown): Promise<Preparado> {
  const archivo = await leerArchivo(file);
  if (!archivo.ok) return archivo;

  const hash = createHash('sha256').update(archivo.bytes).digest('hex');

  const parsed = await parseCalendarioWorkbook(archivo.bytes);
  if (!parsed.ok) return parsed;

  const profiles = await fetchImportProfiles(supabase);
  if (!profiles) return { ok: false, error: E.lectura };

  const validacion = validarFilasImport(parsed.rows, profiles);
  const base = {
    archivo: { nombre: archivo.nombre, hash },
    desde: validacion.desde,
    hasta: validacion.hasta,
    totalFilas: parsed.rows.length,
    errores: validacion.errores.slice(0, MAX_ERRORES_PREVIEW),
    erroresTotal: validacion.errores.length,
  };

  if (validacion.errores.length > 0) {
    return {
      ok: true,
      hash,
      filas: [],
      preview: { ...base, conteos: null, borrados: [], pisados: [], saldo: [] },
    };
  }

  const userIds = [...new Set(validacion.filas.map((f) => f.user_id))];
  const contexto = await fetchImportContext(supabase, userIds, validacion.desde!, validacion.hasta!);
  if (!contexto) return { ok: false, error: E.lectura };

  const plan = calcularPlanImport(validacion.filas, contexto.actuales, contexto.ausencias, contexto.pasajes);

  return {
    ok: true,
    hash,
    filas: validacion.filas,
    preview: {
      ...base,
      conteos: plan.conteos,
      borrados: plan.filas.filter((f) => f.accion === 'borrar').slice(0, MAX_LISTA_PREVIEW).map(aDiaPreview),
      pisados: plan.filas.filter((f) => f.pisado).slice(0, MAX_LISTA_PREVIEW).map(aDiaPreview),
      saldo: calcularImpactoSaldo(plan.filas, contexto.diasTramite),
    },
  };
}

export async function previsualizarImportCalendario(formData: FormData): Promise<PrevisualizarImportResult> {
  await requireAdmin();

  const supabase = await createServerClient();
  const preparado = await prepararImport(supabase, formData.get('file'));
  if (!preparado.ok) return preparado;
  return { ok: true, preview: preparado.preview };
}

function leerConteos(value: FormDataEntryValue | null): ImportConteos | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const keys = ['crear', 'modificar', 'borrar', 'sin_cambios', 'pisados'] as const;
    if (!keys.every((k) => Number.isInteger(parsed[k]) && (parsed[k] as number) >= 0)) return null;
    return Object.fromEntries(keys.map((k) => [k, parsed[k]])) as ImportConteos;
  } catch {
    return null;
  }
}

export async function confirmarImportCalendario(formData: FormData): Promise<ConfirmarImportResult> {
  await requireAdmin();

  // Sin los conteos y el hash de la previsualización no hay confirmación:
  // la previsualización no se puede saltear.
  const esperado = leerConteos(formData.get('esperado'));
  const hashVisto = formData.get('hash');
  if (!esperado || typeof hashVisto !== 'string' || hashVisto === '') {
    return { ok: false, error: E.sinPrevisualizar };
  }

  const supabase = await createServerClient();
  const preparado = await prepararImport(supabase, formData.get('file'));
  if (!preparado.ok) return preparado;

  if (preparado.hash !== hashVisto) return { ok: false, error: E.archivoDistinto, desactualizado: true };
  if (preparado.preview.erroresTotal > 0 || !preparado.preview.conteos) {
    return { ok: false, error: E.conErrores };
  }
  // Atajo: si ya acá los conteos no coinciden, ni se llama a la RPC. La
  // comparación que vale es la de la RPC, dentro de la transacción.
  if (!mismosConteos(preparado.preview.conteos, esperado)) {
    return { ok: false, error: E.desactualizado, desactualizado: true };
  }

  // p_esperado = lo que VIO el admin, no lo recalculado recién.
  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never`/`undefined` en .rpc() (mismo bug ya documentado en
  // aprobaciones/ausencia-actions.ts); el cast es solo de tipos.
  const { data, error } = await supabase.rpc('importar_calendario', {
    p_filas: filasParaRpc(preparado.filas),
    p_esperado: esperado,
  } as never);

  if (error) {
    console.error('[confirmarImportCalendario] error de la RPC:', error.code, error.message);
    if (error.code === '40001') return { ok: false, error: E.desactualizado, desactualizado: true };
    return { ok: false, error: E.escritura };
  }

  revalidatePath('/calendario');
  const r = data as Record<string, number>;
  return {
    ok: true,
    resultado: {
      creadas: r.creadas,
      modificadas: r.modificadas,
      borradas: r.borradas,
      sin_cambios: r.sin_cambios,
      pisadas: r.pisadas,
    },
  };
}
