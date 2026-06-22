'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { copy } from '@/lib/copy';

// ─── Aprobar documento ────────────────────────────────────────

export async function approveDocument(documentId: string): Promise<void> {
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

  if (error) throw new Error(error.message);

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
}

// ─── Rechazar documento ───────────────────────────────────────

export async function rejectDocument(documentId: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error(copy.aprobaciones.rejectModal.motivoRequired);

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

  if (error) throw new Error(error.message);

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

  revalidatePath('/aprobaciones');
  revalidatePath('/mi-perfil');
}
