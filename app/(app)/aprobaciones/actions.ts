'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { copy } from '@/lib/copy';
import { sendDocumentRejectionEmail } from '@/lib/email/rejection-email';

// Resultado devuelto (nunca throw para un error esperado): en un build de
// producción, Next.js redacta el mensaje de cualquier error que cruce el
// límite de una Server Action, aunque el cliente lo atrapa con try/catch —
// mismo bug ya resuelto en aprobadas/actions.ts (FB-F4-14) y en
// aprobaciones/ausencia-actions.ts / pasaje-actions.ts y
// solicitud-ausencia|pasaje/actions.ts (FB-F4-16). Este archivo quedaba
// pendiente (documentado, no tocado, en esos prompts) — FB-F4-18 lo cierra.
export type DocumentActionResult = { ok: true } | { ok: false; error: string };

// ─── Aprobar documento ────────────────────────────────────────

export async function approveDocument(documentId: string): Promise<DocumentActionResult> {
  const admin_profile = await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from('documents')
    .update({
      estado:      'aprobado',
      reviewed_by: admin_profile.id,
      reviewed_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('estado', 'pendiente'); // solo transicionamos desde pendiente

  if (error) return { ok: false, error: error.message };

  // Registrar en audit_log (no bloqueante: si falla, la aprobación ya se aplicó)
  try {
    await admin.from('audit_log').insert({
      actor_id:   admin_profile.id,
      action:     'document_approved',
      table_name: 'documents',
      record_id:  documentId,
      new_data:   { estado: 'aprobado' },
    });
  } catch (auditErr) {
    console.error('[audit] fallo al registrar aprobación de documento:', auditErr);
  }

  revalidatePath('/aprobaciones');
  revalidatePath('/mi-perfil');
  return { ok: true };
}

// ─── Rechazar documento ───────────────────────────────────────

export async function rejectDocument(documentId: string, motivo: string): Promise<DocumentActionResult> {
  if (!motivo.trim()) return { ok: false, error: copy.aprobaciones.rejectModal.motivoRequired };

  const admin_profile = await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from('documents')
    .update({
      estado:         'rechazado',
      motivo_rechazo: motivo.trim(),
      reviewed_by:    admin_profile.id,
      reviewed_at:    new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    })
    .eq('id', documentId)
    .eq('estado', 'pendiente');

  if (error) return { ok: false, error: error.message };

  // Registrar en audit_log (no bloqueante: si falla, el rechazo ya se aplicó)
  try {
    await admin.from('audit_log').insert({
      actor_id:   admin_profile.id,
      action:     'document_rejected',
      table_name: 'documents',
      record_id:  documentId,
      new_data:   { estado: 'rechazado', motivo_rechazo: motivo.trim() },
    });
  } catch (auditErr) {
    console.error('[audit] fallo al registrar rechazo de documento:', auditErr);
  }

  // Notificar por email al empleado dueño (no bloqueante, no silencioso).
  // El rechazo es la fuente de verdad: un fallo de email no lo revierte, pero
  // se loguea de forma visible en vez de tragarse el error.
  try {
    const { data: doc, error: docErr } = await admin
      .from('documents')
      .select('user_id, document_type')
      .eq('id', documentId)
      .single();
    if (docErr || !doc) {
      throw docErr ?? new Error('No se encontró el documento para notificar.');
    }

    const { data: owner, error: ownerErr } = await admin
      .from('profiles')
      .select('email, full_name')
      .eq('id', doc.user_id)
      .single();
    if (ownerErr || !owner) {
      throw ownerErr ?? new Error('No se encontró el perfil del dueño del documento.');
    }

    if (!owner.email) {
      // Caso borde: perfil sin email. No crashea el rechazo; se loguea el skip.
      console.warn(
        `[email] rechazo de documento ${documentId}: el empleado no tiene email en el perfil, se omite el envío.`
      );
    } else {
      await sendDocumentRejectionEmail({
        to:           owner.email,
        fullName:     owner.full_name,
        documentType: doc.document_type,
        motivo:       motivo.trim(),
      });
    }
  } catch (emailErr) {
    console.error('[email] fallo al notificar rechazo de documento:', emailErr);
  }

  revalidatePath('/aprobaciones');
  revalidatePath('/mi-perfil');
  return { ok: true };
}
