import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { ProfileView } from './ProfileView';
import { ProfileEditForm } from './ProfileEditForm';
import { DocumentsSection } from './DocumentsSection';
import { AdminEmployeeSelector } from './AdminEmployeeSelector';
import { getSignedUrls } from './actions';
import type { Document } from '@/lib/db-types';

export default async function MiPerfilPage() {
  const profile = await requireAuth();
  const isAdmin = profile.role === 'admin';

  const supabase = await createServerClient();

  // Cargar documentos del usuario autenticado (RLS filtra por user_id = auth.uid())
  // Admin-only: estudio_medico también se muestra al admin
  const { data: docsRaw, error: docsError } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false });

  const allDocs = (docsRaw as Document[] | null) ?? [];

  // El empleado ve su propio estudio_medico (contrato A3).
  // RLS de 0004_rls_fixes ya impide que otros empleados y el supervisor lo vean.
  const documents = allDocs;

  // Solo generar signed URLs para documentos con archivo disponible (no purgados)
  const storagePaths = documents
    .filter((d) => !d.file_purged_at)
    .map((d) => d.storage_path);
  const signedUrls = await getSignedUrls(storagePaths);

  const documentsWithUrls = documents.map((d) => ({
    ...d,
    signedUrl: signedUrls[d.storage_path] ?? '',
  }));

  // Sanitizar campos solo-admin antes de serializar al cliente
  const safeProfile = isAdmin ? profile : { ...profile, entrevista_tecnica: null };

  if (docsError) {
    return (
      <Card>
        <p className="text-error text-sm">{copy.errors.generic}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado de módulo */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-secondary">{copy.miPerfil.title}</h2>
          <p className="text-sm text-neutral mt-0.5">{copy.miPerfil.subtitle}</p>
        </div>
        {/* Admin puede editar su propio perfil directamente */}
        {isAdmin && <ProfileEditForm profile={profile} />}
      </div>

      {/* Selector de empleado solo para admin */}
      {isAdmin && <AdminEmployeeSelector />}

      {/* Datos personales (lectura) — safeProfile omite entrevista_tecnica para no-admin */}
      <ProfileView profile={safeProfile} isAdmin={isAdmin} />

      {/* Documentos */}
      <DocumentsSection documents={documentsWithUrls} />
    </div>
  );
}
