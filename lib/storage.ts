// Helper de acceso privado a Storage. Todas las URLs son signed (tiempo
// limitado), nunca públicas. El flujo de carga de documentos (UI) vive en
// Fase 1 (Mi Perfil); el de procedimientos, en Fase 5.
//
// FB-F5-06: generalizado para soportar más de un bucket (documents +
// procedimientos) sin duplicar la lógica de validar/subir/firmar — los
// exports originales (validateDocumentFile, createSignedUrl, uploadDocument,
// DOCUMENTS_BUCKET) conservan firma y comportamiento exactos; son wrappers
// finos sobre las versiones genéricas de abajo.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { copy } from '@/lib/copy';

// Solo depende de `.storage` (agnóstico al schema `Database`) — evita el
// choque de tipos entre el cliente admin (@supabase/supabase-js) y el de
// sesión (@supabase/ssr): ambos exponen `.storage` con la misma forma, pero
// sus genéricos de `Database["public"]` no son estructuralmente idénticos.
type StorageClient = Pick<SupabaseClient, 'storage'>;

const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hora
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — mismo límite para todos los buckets del portal

// ─── Validación (genérica) ─────────────────────────────────────

export type ValidateDocumentFileResult = { ok: true } | { ok: false; error: string };

type ValidateFileOptions = {
  maxSizeBytes: number;
  allowedMimeTypes: ReadonlySet<string>;
  errorTooLarge: string;
  errorTypeNotAllowed: string;
};

// Resultado devuelto (nunca throw para un error esperado): mismo motivo que
// las Server Actions (FB-F4-14/16/18) — un throw que cruza el límite de una
// Server Action se redacta en build de producción. Este helper es compartido
// por más de un caller, así que la traducción vive acá, en la raíz, en vez
// de depender de que cada caller futuro se acuerde de envolverlo (FB-F4-19,
// hallazgo de FB-F4-AUD-13: antes el helper seguía tirando y cada caller
// tenía que envolverlo — una trampa latente para un caller nuevo).
export function validateFile(
  file: { size: number; type: string },
  opts: ValidateFileOptions
): ValidateDocumentFileResult {
  if (file.size > opts.maxSizeBytes) {
    return { ok: false, error: opts.errorTooLarge };
  }
  if (!opts.allowedMimeTypes.has(file.type)) {
    return { ok: false, error: `${opts.errorTypeNotAllowed} ${file.type}` };
  }
  return { ok: true };
}

// ─── Signed URL (genérica) ──────────────────────────────────────

export type CreateSignedUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Genera una URL de acceso privada y temporaria para un archivo en Storage,
 * contra el bucket y el cliente indicados. Nunca devuelve una URL pública.
 */
export async function createSignedUrlIn(
  client: StorageClient,
  bucket: string,
  storagePath: string,
  expirySeconds: number = SIGNED_URL_EXPIRY_SECONDS
): Promise<CreateSignedUrlResult> {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(storagePath, expirySeconds);

  if (error) return { ok: false, error: error.message };
  if (!data?.signedUrl) return { ok: false, error: copy.documentos.errors.urlNoDisponible };

  return { ok: true, url: data.signedUrl };
}

// ─── Upload (genérica) ──────────────────────────────────────────

export type UploadFileResult = { ok: true; storagePath: string } | { ok: false; error: string };

export async function uploadFileTo(
  client: StorageClient,
  bucket: string,
  storagePath: string,
  file: File
): Promise<UploadFileResult> {
  const { error } = await client.storage
    .from(bucket)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, storagePath };
}

export async function removeFileFrom(
  client: StorageClient,
  bucket: string,
  storagePath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client.storage.from(bucket).remove([storagePath]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// documents (Fase 1) — comportamiento y firmas sin cambios
// ════════════════════════════════════════════════════════════════

export const DOCUMENTS_BUCKET = 'documents';

const DOCUMENTS_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export function validateDocumentFile(file: { size: number; type: string }): ValidateDocumentFileResult {
  return validateFile(file, {
    maxSizeBytes: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: DOCUMENTS_ALLOWED_MIME_TYPES,
    errorTooLarge: copy.documentos.errors.archivoDemasiadoGrande,
    errorTypeNotAllowed: copy.documentos.errors.tipoArchivoNoPermitido,
  });
}

/**
 * Genera una URL de acceso privada y temporaria para un documento.
 * Nunca devuelve una URL pública; el bucket está configurado como privado.
 */
export async function createSignedUrl(storagePath: string): Promise<CreateSignedUrlResult> {
  return createSignedUrlIn(createAdminClient(), DOCUMENTS_BUCKET, storagePath);
}

export type UploadDocumentResult =
  | { ok: true; storagePath: string; signedUrl: string }
  | { ok: false; error: string };

/**
 * Sube un documento al bucket privado y devuelve la ruta de Storage + URL firmada.
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
  const uploadResult = await uploadFileTo(admin, DOCUMENTS_BUCKET, storagePath, file);
  if (!uploadResult.ok) return uploadResult;

  const signedUrlResult = await createSignedUrlIn(admin, DOCUMENTS_BUCKET, storagePath);
  if (!signedUrlResult.ok) return signedUrlResult;

  return { ok: true, storagePath, signedUrl: signedUrlResult.url };
}

// ════════════════════════════════════════════════════════════════
// procedimientos (Fase 5, FB-F5-06)
// ════════════════════════════════════════════════════════════════

export const PROCEDURES_BUCKET = 'procedimientos';

const PROCEDURES_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export function validateProcedureFile(file: { size: number; type: string }): ValidateDocumentFileResult {
  return validateFile(file, {
    maxSizeBytes: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: PROCEDURES_ALLOWED_MIME_TYPES,
    errorTooLarge: copy.procedimientos.errors.archivoDemasiadoGrande,
    errorTypeNotAllowed: copy.procedimientos.errors.tipoArchivoNoPermitido,
  });
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120);
  return trimmed || 'archivo';
}

export type UploadProcedureFileResult = { ok: true; storagePath: string } | { ok: false; error: string };

/**
 * Sube un archivo de procedimiento al bucket privado 'procedimientos' con
 * el cliente indicado (siempre el del usuario autenticado — nunca el admin,
 * ver reglas técnicas de FB-F5-06) y devuelve la ruta de Storage.
 *
 * Path: {uuid-random}/{filename-sanitizado} — SIN {userId}: un
 * procedimiento no tiene dueño individual (migración 0020, §7). No usa el
 * id de `procedures` porque al crear todavía no existe (la RPC lo devuelve
 * recién después del INSERT) — las políticas de storage.objects para este
 * bucket controlan acceso por bucket + rol, no por estructura de path, así
 * que un UUID random alcanza.
 */
export async function uploadProcedureFile(
  client: StorageClient,
  file: File
): Promise<UploadProcedureFileResult> {
  const validation = validateProcedureFile(file);
  if (!validation.ok) return validation;

  const storagePath = `${crypto.randomUUID()}/${sanitizeFilename(file.name)}`;
  return uploadFileTo(client, PROCEDURES_BUCKET, storagePath, file);
}

export async function createProcedureSignedUrl(
  client: StorageClient,
  storagePath: string
): Promise<CreateSignedUrlResult> {
  return createSignedUrlIn(client, PROCEDURES_BUCKET, storagePath);
}

/**
 * Borra un archivo de procedimiento del bucket. SIEMPRE best-effort: el
 * caller decide qué hacer si falla (loguear, nunca revertir la operación
 * principal) — ver reglas de FB-F5-06 sobre reemplazo de archivo.
 */
export async function removeProcedureFile(
  client: StorageClient,
  storagePath: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return removeFileFrom(client, PROCEDURES_BUCKET, storagePath);
}
