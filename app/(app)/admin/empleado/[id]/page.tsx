import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { copy } from '@/lib/copy';
import { ProfileView } from '@/app/(app)/mi-perfil/ProfileView';
import { ProfileEditForm } from '@/app/(app)/mi-perfil/ProfileEditForm';
import { DocumentsSection } from '@/app/(app)/mi-perfil/DocumentsSection';
import { getSignedUrls } from '@/app/(app)/mi-perfil/actions';
import type { Profile, Document } from '@/lib/db-types';

export default async function AdminEmpleadoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const admin = createAdminClient();

  const { data: rawProfile, error: profileError } = await admin
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (profileError) {
    console.error('[AdminEmpleadoPage] error al cargar perfil:', profileError.message);
    notFound();
  }
  if (!rawProfile) notFound();

  const employeeProfile = rawProfile as Profile;

  const { data: docsRaw, error: docsError } = await admin
    .from('documents')
    .select('*')
    .eq('user_id', id)
    .order('created_at', { ascending: false });

  if (docsError) {
    console.error('[AdminEmpleadoPage] error al cargar documentos:', docsError.message);
  }

  const docs = (docsRaw ?? []) as Document[];

  // Solo generar signed URLs para archivos no purgados
  const storagePaths = docs
    .filter((d) => !d.file_purged_at)
    .map((d) => d.storage_path);
  const signedUrls = await getSignedUrls(storagePaths);

  const documentsWithUrls = docs.map((d) => ({
    ...d,
    signedUrl: d.file_purged_at ? '' : (signedUrls[d.storage_path] ?? ''),
  }));

  const displayName = employeeProfile.full_name || employeeProfile.email;

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/mi-perfil"
            className="inline-flex items-center gap-1.5 text-sm text-neutral hover:text-primary mb-2"
          >
            <ArrowLeft size={14} />
            {copy.adminEmpleado.backButton}
          </Link>
          <h2 className="text-lg font-semibold text-secondary">
            {copy.adminEmpleado.pageTitle}
          </h2>
          <p className="text-sm text-neutral mt-0.5">{displayName}</p>
        </div>
        <ProfileEditForm profile={employeeProfile} />
      </div>

      {/* Datos del empleado (admin ve todo incluyendo estado y entrevista) */}
      <ProfileView profile={employeeProfile} isAdmin={true} />

      {/* Documentos del empleado (admin ve todo, incluye estudio_medico) */}
      <DocumentsSection
        documents={documentsWithUrls}
        targetUserId={id}
      />
    </div>
  );
}
