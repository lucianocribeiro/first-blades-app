'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin, requireAuth } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { uploadDocument as storageUpload, createSignedUrl, validateDocumentFile } from '@/lib/storage';
import type { ProfileUpdate, CertificadoTipo, EntrevistaTecnica, DocumentType, DocumentInsert } from '@/lib/db-types';
import { DOCUMENT_TYPES } from '@/lib/db-types';
import { copy } from '@/lib/copy';

// ─── Actualizar perfil (solo admin) ──────────────────────────

export type UpdateProfileInput = {
  id: string;
  full_name?: string;
  phone?: string;
  cuit?: string;
  winda_id?: string;
  dni?: string;
  fecha_ingreso?: string;
  // Campos solo-admin
  status?: 'activo' | 'inactivo' | 'pendiente';
  entrevista_tecnica?: EntrevistaTecnica;
};

export async function updateProfile(input: UpdateProfileInput) {
  await requireAdmin();
  const admin = createAdminClient();

  const update: ProfileUpdate = {
    full_name:    input.full_name    || null,
    phone:        input.phone        || null,
    cuit:         input.cuit         || null,
    winda_id:     input.winda_id     || null,
    dni:          input.dni          || null,
    fecha_ingreso: input.fecha_ingreso || null,
    status:       input.status,
    entrevista_tecnica: input.entrevista_tecnica ?? null,
    updated_at:   new Date().toISOString(),
  };

  const { error } = await admin
    .from('profiles')
    .update(update)
    .eq('id', input.id);

  if (error) throw new Error(error.message);
  revalidatePath('/mi-perfil');
}

// ─── Subir documento (usuario propio) ────────────────────────

const ALLOWED_DOCUMENT_TYPES: DocumentType[] = ['dni', 'licencia', 'foto_carnet', 'certificado'];

// Resultado devuelto (nunca throw para un error esperado): mismo motivo que
// aprobaciones/actions.ts (FB-F4-18) — un throw que cruza el límite de una
// Server Action se redacta en build de producción.
export type DocumentUploadResult = { ok: true } | { ok: false; error: string };

export async function handleDocumentUpload(formData: FormData): Promise<DocumentUploadResult> {
  const profile = await requireAuth();

  const file          = formData.get('file') as File | null;
  const documentType  = formData.get('document_type') as string;
  const certTipo      = formData.get('certificado_tipo') as CertificadoTipo | null;
  const certOtrosText = (formData.get('certificado_otros_texto') as string | null)?.trim() || null;
  const fechaVenc     = (formData.get('fecha_vencimiento') as string | null) || null;

  if (!file || file.size === 0) return { ok: false, error: copy.documentos.errors.archivoRequerido };

  if (!ALLOWED_DOCUMENT_TYPES.includes(documentType as DocumentType)) {
    return { ok: false, error: copy.documentos.errors.tipoNoPermitido };
  }

  // Validar campos de certificado
  if (documentType === 'certificado') {
    if (!certTipo) return { ok: false, error: copy.documentos.errors.certificadoTipoRequerido };
    if (certTipo === 'otros' && !certOtrosText) return { ok: false, error: copy.documentos.errors.descripcionRequerida };
    if (certOtrosText && certOtrosText.length > 80) return { ok: false, error: copy.documentos.errors.descripcionMaxima };
  }

  // Validar archivo (tamaño / mime) — mismo criterio de error esperado.
  try {
    validateDocumentFile({ size: file.size, type: file.type });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : copy.documentos.messages.uploadError };
  }

  // Subir a Storage (admin client: validación ya hecha, path enforces userId)
  let storagePath: string;
  try {
    ({ storagePath } = await storageUpload(profile.id, file, documentType));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : copy.documentos.messages.uploadError };
  }

  // Insertar en documents vía admin client (server action ya validó identidad y constraints).
  // estado forzado a 'pendiente' en código; el admin client garantiza que el write no falla
  // por RLS mientras la lógica de autorización ya fue verificada arriba.
  const adminClient = createAdminClient();
  const insertData: DocumentInsert = {
    user_id:                profile.id,
    uploaded_by:            profile.id,
    document_type:          documentType,
    filename:               file.name,
    storage_path:           storagePath,
    file_size:              file.size,
    mime_type:              file.type,
    estado:                 'pendiente',
    certificado_tipo:       documentType === 'certificado' ? (certTipo ?? null) : null,
    certificado_otros_texto: documentType === 'certificado' && certTipo === 'otros' ? certOtrosText : null,
    fecha_vencimiento:      fechaVenc || null,
  };
  const { error } = await adminClient.from('documents').insert(insertData);

  if (error) {
    // Si el INSERT falla, borrar el objeto de Storage para no dejar huérfanos
    const admin = createAdminClient();
    await admin.storage.from('documents').remove([storagePath]);
    return { ok: false, error: error.message };
  }

  revalidatePath('/mi-perfil');
  return { ok: true };
}

// ─── Generar signed URLs para documentos (servidor) ──────────

export async function getSignedUrls(
  paths: string[]
): Promise<Record<string, string>> {
  await requireAuth();

  if (paths.length === 0) return {};

  // Filtrar por lo que el usuario puede ver vía RLS (cliente con sesión, NO admin).
  // La policy documents_select aplica: empleado ve los suyos, admin ve todos.
  const supabase = await createServerClient();
  // La cadena .in() con el generics de postgrest-js puede inferir `never` en TS;
  // el cast es seguro: estamos seleccionando exactamente storage_path (string NOT NULL).
  const { data: rawVisibles, error: visiblesError } = await supabase
    .from('documents')
    .select('storage_path')
    .in('storage_path', paths as readonly string[]);

  if (visiblesError) {
    console.error('[getSignedUrls] error al consultar documentos visibles:', visiblesError.message);
    throw new Error(copy.errors.generic);
  }

  const visibles = rawVisibles as Array<{ storage_path: string }> | null;

  const authorized = new Set((visibles ?? []).map((d) => d.storage_path));

  const result: Record<string, string> = {};
  for (const path of paths) {
    if (!authorized.has(path)) continue;
    try {
      result[path] = await createSignedUrl(path);
    } catch {
      result[path] = '';
    }
  }
  return result;
}

// ─── Buscar empleados (solo admin) ───────────────────────────

export type EmployeeSearchResult = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
};

// Escapa caracteres especiales de PostgREST en el valor del filtro .or()
function escapePostgrestFilter(s: string): string {
  return s.replace(/[(),."*\\]/g, '');
}

export async function searchEmployees(q: string): Promise<EmployeeSearchResult[]> {
  await requireAdmin();
  if (q.trim().length < 2) return [];

  const safe = escapePostgrestFilter(q.trim());
  if (safe.length === 0) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email, role')
    .neq('role', 'admin')
    .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`)
    .limit(10);

  if (error) {
    console.error('[searchEmployees] error en query:', error.message);
    throw new Error(copy.errors.generic);
  }

  return (data ?? []) as EmployeeSearchResult[];
}

// ─── Cargar documento para empleado (solo admin, aprobado directo) ───

export async function uploadDocumentForEmployee(
  formData: FormData,
  employeeId: string
): Promise<DocumentUploadResult> {
  const adminProfile = await requireAdmin();

  const file          = formData.get('file') as File | null;
  const documentType  = formData.get('document_type') as string;
  const certTipo      = formData.get('certificado_tipo') as CertificadoTipo | null;
  const certOtrosText = (formData.get('certificado_otros_texto') as string | null)?.trim() || null;
  const fechaVenc     = (formData.get('fecha_vencimiento') as string | null) || null;

  if (!file || file.size === 0) return { ok: false, error: copy.documentos.errors.archivoRequerido };

  if (!DOCUMENT_TYPES.includes(documentType as DocumentType)) {
    return { ok: false, error: copy.documentos.errors.tipoNoPermitido };
  }

  if (documentType === 'certificado') {
    if (!certTipo) return { ok: false, error: copy.documentos.errors.certificadoTipoRequerido };
    if (certTipo === 'otros' && !certOtrosText) return { ok: false, error: copy.documentos.errors.descripcionRequerida };
    if (certOtrosText && certOtrosText.length > 80) return { ok: false, error: copy.documentos.errors.descripcionMaxima };
  }

  try {
    validateDocumentFile({ size: file.size, type: file.type });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : copy.documentos.messages.uploadError };
  }

  let storagePath: string;
  try {
    ({ storagePath } = await storageUpload(employeeId, file, documentType));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : copy.documentos.messages.uploadError };
  }

  const adminClient = createAdminClient();
  const insertData: DocumentInsert = {
    user_id:                employeeId,
    uploaded_by:            adminProfile.id,
    document_type:          documentType,
    filename:               file.name,
    storage_path:           storagePath,
    file_size:              file.size,
    mime_type:              file.type,
    estado:                 'aprobado',
    reviewed_by:            adminProfile.id,
    reviewed_at:            new Date().toISOString(),
    certificado_tipo:       documentType === 'certificado' ? (certTipo ?? null) : null,
    certificado_otros_texto: documentType === 'certificado' && certTipo === 'otros' ? certOtrosText : null,
    fecha_vencimiento:      fechaVenc || null,
  };

  const { error } = await adminClient.from('documents').insert(insertData);

  if (error) {
    await adminClient.storage.from('documents').remove([storagePath]);
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/empleado/${employeeId}`);
  return { ok: true };
}
