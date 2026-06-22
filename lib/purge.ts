import { createAdminClient } from '@/lib/supabase/admin';
import { DOCUMENTS_BUCKET } from '@/lib/storage';

export const RETENTION_DAYS = 30;

export type PurgeResult = {
  purged: number;
  failed: number;
};

/**
 * Determina si un documento es candidato a purga de archivo físico.
 * Función pura sin I/O — usada directamente en unit tests.
 *
 * @param doc   Fila de documents con los campos relevantes
 * @param cutoff Límite de fecha: reviewed_at anterior a esta fecha es elegible
 */
export function isEligibleForPurge(
  doc: { estado: string; reviewed_at: string | null; file_purged_at: string | null },
  cutoff: Date
): boolean {
  if (doc.estado !== 'rechazado') return false;
  if (doc.file_purged_at !== null) return false;
  if (!doc.reviewed_at) return false;
  return new Date(doc.reviewed_at) < cutoff;
}

/**
 * Calcula la fecha de corte para purga (hoy - RETENTION_DAYS).
 */
export function getPurgeCutoff(referenceDate: Date = new Date()): Date {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  return cutoff;
}

/**
 * Purga los archivos físicos de Storage para documentos rechazados
 * cuyo reviewed_at supera RETENTION_DAYS días.
 *
 * Invariantes:
 * - El row de documents NUNCA se borra.
 * - Solo se elimina el archivo físico en Storage.
 * - Idempotente: la condición `file_purged_at IS NULL` evita reprocesar.
 * - El campo storage_path NO se nulifica (queda como auditoría).
 * - Si remove() falla, la fila NO se marca: queda elegible para reintento.
 *
 * @param client Cliente Supabase inyectable (default = admin de prod). Permite testeo.
 */
export async function purgeRejectedDocuments(
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<PurgeResult> {
  const result: PurgeResult = { purged: 0, failed: 0 };

  const cutoff = getPurgeCutoff().toISOString();

  const { data: docs, error: selectError } = await client
    .from('documents')
    .select('id, storage_path')
    .eq('estado', 'rechazado')
    .is('file_purged_at', null)
    .not('reviewed_at', 'is', null)
    .lt('reviewed_at', cutoff);

  if (selectError) throw new Error(selectError.message);
  if (!docs?.length) return result;

  for (const doc of docs) {
    const { error: removeError } = await client.storage
      .from(DOCUMENTS_BUCKET)
      .remove([doc.storage_path]);

    if (removeError) {
      console.error(`[purge] fallo al borrar ${doc.storage_path}:`, removeError);
      result.failed++;
      continue; // no marcar file_purged_at: la fila queda elegible para reintento
    }

    const { error: updateError } = await client
      .from('documents')
      .update({ file_purged_at: new Date().toISOString() })
      .eq('id', doc.id)
      .is('file_purged_at', null); // guarda de idempotencia

    if (updateError) {
      console.error(`[purge] fallo al marcar file_purged_at para ${doc.id}:`, updateError);
      result.failed++;
      continue;
    }

    result.purged++;
  }

  return result;
}
