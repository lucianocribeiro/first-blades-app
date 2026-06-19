import { createAdminClient } from '@/lib/supabase/admin';
import { DOCUMENTS_BUCKET } from '@/lib/storage';

export const RETENTION_DAYS = 30;

export type PurgeResult = {
  purged: number;
  errors: { id: string; error: string }[];
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
 */
export async function purgeRejectedDocuments(): Promise<PurgeResult> {
  const admin = createAdminClient();
  const result: PurgeResult = { purged: 0, errors: [] };

  const cutoff = getPurgeCutoff().toISOString();

  const { data: docs, error: selectError } = await admin
    .from('documents')
    .select('id, storage_path')
    .eq('estado', 'rechazado')
    .is('file_purged_at', null)
    .not('reviewed_at', 'is', null)
    .lt('reviewed_at', cutoff);

  if (selectError) throw new Error(selectError.message);
  if (!docs?.length) return result;

  for (const doc of docs) {
    try {
      await admin.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);

      const { error: updateError } = await admin
        .from('documents')
        .update({ file_purged_at: new Date().toISOString() })
        .eq('id', doc.id)
        .is('file_purged_at', null); // guarda de idempotencia

      if (updateError) throw new Error(updateError.message);
      result.purged++;
    } catch (err) {
      result.errors.push({
        id: doc.id,
        error: err instanceof Error ? err.message : 'Error desconocido',
      });
    }
  }

  return result;
}
