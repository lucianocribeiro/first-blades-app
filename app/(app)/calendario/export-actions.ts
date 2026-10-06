'use server';

// FB-PI-04 — Export del calendario a Excel (solo admin, solo lectura).
//
// Contratos (constitución §2.5):
// - Guard de rol: requireAdmin() corta por redirect() ANTES de crear el
//   cliente o leer nada (excepción FB-F5-AUD-05) — no devuelve { ok }.
// - Errores de negocio de una llamada ya autorizada (rango inválido, lectura
//   o generación fallida): { ok: false, error } con copy es-AR.
// - Cliente de sesión (createServerClient), nunca createAdminClient: la
//   lectura pasa por RLS.
//
// El archivo viaja como base64 en la respuesta de la action y el cliente
// arma el Blob de descarga (ver ExportarExcelPanel). Tamaño acotado por
// MAX_DIAS_EXPORT.
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { fetchCalendarioExportData, validarRangoExport } from '@/lib/rotation/calendario-export';
import { buildCalendarioWorkbook, exportFilename } from '@/lib/rotation/calendario-excel';

export type ExportarCalendarioInput = { desde: string; hasta: string };

export type ExportarCalendarioResult =
  | { ok: true; filename: string; base64: string }
  | { ok: false; error: string };

export async function exportarCalendarioExcel(
  input: ExportarCalendarioInput
): Promise<ExportarCalendarioResult> {
  await requireAdmin();

  const desde = typeof input?.desde === 'string' ? input.desde : '';
  const hasta = typeof input?.hasta === 'string' ? input.hasta : '';

  const rangoError = validarRangoExport(desde, hasta);
  if (rangoError) return { ok: false, error: rangoError };

  const supabase = await createServerClient();
  const data = await fetchCalendarioExportData(supabase, desde, hasta);
  if (!data) return { ok: false, error: copy.calendario.excel.errors.generacion };

  try {
    const buffer = await buildCalendarioWorkbook(data, desde, hasta);
    return { ok: true, filename: exportFilename(desde, hasta), base64: buffer.toString('base64') };
  } catch (err) {
    console.error('[exportarCalendarioExcel] error al generar el archivo:', err);
    return { ok: false, error: copy.calendario.excel.errors.generacion };
  }
}
