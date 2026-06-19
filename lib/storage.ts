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

// ─── Validación ───────────────────────────────────────────────

export function validateDocumentFile(file: { size: number; type: string }): void {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(copy.documentos.errors.archivoDemasiadoGrande);
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(`${copy.documentos.errors.tipoArchivoNoPermitido} ${file.type}`);
  }
}

// ─── Signed URL ───────────────────────────────────────────────

/**
 * Genera una URL de acceso privada y temporaria para un archivo en Storage.
 * Nunca devuelve una URL pública; el bucket está configurado como privado.
 */
export async function createSignedUrl(storagePath: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error(copy.documentos.errors.urlNoDisponible);

  return data.signedUrl;
}

// ─── Upload ───────────────────────────────────────────────────

/**
 * Sube un archivo al bucket privado y devuelve la ruta de Storage + URL firmada.
 * La ruta sigue el patrón: {userId}/{documentType}-{timestamp}.{ext}
 * Solo accesible a través de signed URLs, nunca de forma pública.
 */
export async function uploadDocument(
  userId: string,
  file: File,
  documentType: string
): Promise<{ storagePath: string; signedUrl: string }> {
  validateDocumentFile(file);

  const ext = file.name.split('.').pop() ?? 'bin';
  const storagePath = `${userId}/${documentType}-${Date.now()}.${ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  const signedUrl = await createSignedUrl(storagePath);

  return { storagePath, signedUrl };
}
