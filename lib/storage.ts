// Helper de acceso privado al bucket de documentos.
// Todas las URLs son signed (tiempo limitado), nunca públicas.
// El flujo de carga de documentos (UI) vive en Fase 1 (Mi Perfil).

import { createAdminClient } from '@/lib/supabase/admin';
import { copy } from '@/lib/copy';

export const DOCUMENTS_BUCKET = 'documents';
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hora

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Resultado devuelto (nunca throw para un error esperado): mismo motivo que
// las Server Actions (FB-F4-14/16/18) — un throw que cruza el límite de una
// Server Action se redacta en build de producción. Este helper es compartido
// por más de un caller, así que la traducción vive acá, en la raíz, en vez
// de depender de que cada caller futuro se acuerde de envolverlo (FB-F4-19,
// hallazgo de FB-F4-AUD-13: antes el helper seguía tirando y cada caller
// tenía que envolverlo — una trampa latente para un caller nuevo).

// ─── Validación ───────────────────────────────────────────────

export type ValidateDocumentFileResult = { ok: true } | { ok: false; error: string };

export function validateDocumentFile(file: { size: number; type: string }): ValidateDocumentFileResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: copy.documentos.errors.archivoDemasiadoGrande };
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false, error: `${copy.documentos.errors.tipoArchivoNoPermitido} ${file.type}` };
  }
  return { ok: true };
}

// ─── Signed URL ───────────────────────────────────────────────

export type CreateSignedUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Genera una URL de acceso privada y temporaria para un archivo en Storage.
 * Nunca devuelve una URL pública; el bucket está configurado como privado.
 */
export async function createSignedUrl(storagePath: string): Promise<CreateSignedUrlResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error) return { ok: false, error: error.message };
  if (!data?.signedUrl) return { ok: false, error: copy.documentos.errors.urlNoDisponible };

  return { ok: true, url: data.signedUrl };
}

// ─── Upload ───────────────────────────────────────────────────

export type UploadDocumentResult =
  | { ok: true; storagePath: string; signedUrl: string }
  | { ok: false; error: string };

/**
 * Sube un archivo al bucket privado y devuelve la ruta de Storage + URL firmada.
 * La ruta sigue el patrón: {userId}/{documentType}-{timestamp}.{ext}
 * Solo accesible a través de signed URLs, nunca de forma pública.
 */
export async function uploadDocument(
  userId: string,
  file: File,
  documentType: string
): Promise<UploadDocumentResult> {
  const validation = validateDocumentFile(file);
  if (!validation.ok) return validation;

  const ext = file.name.split('.').pop() ?? 'bin';
  const storagePath = `${userId}/${documentType}-${Date.now()}.${ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });

  if (uploadError) return { ok: false, error: uploadError.message };

  const signedUrlResult = await createSignedUrl(storagePath);
  if (!signedUrlResult.ok) return signedUrlResult;

  return { ok: true, storagePath, signedUrl: signedUrlResult.url };
}
