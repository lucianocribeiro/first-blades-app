import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileDown } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { createProcedureSignedUrl } from '@/lib/storage';
import { renderMarkdownToSafeHtml } from '@/lib/markdown';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Procedure } from '@/lib/db-types';

export default async function ProcedimientoViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireAuth();
  const isAdmin = profile.role === 'admin';
  const { id } = await params;

  const supabase = await createServerClient();

  // RLS ya oculta un archivado a no-admin (procedures_select); si la fila no
  // aparece, no hay forma de distinguir "no existe" de "está archivado y no
  // es admin" desde acá — y no hace falta: el resultado visible es el mismo
  // (notFound), sin filtrar cuál de los dos casos es.
  const { data, error } = await supabase.from('procedures').select('*').eq('id', id).maybeSingle();

  if (error) {
    console.error('[ProcedimientoViewPage] error al cargar procedimiento:', error.message);
    notFound();
  }
  if (!data) notFound();

  const procedimiento = data as Procedure;

  let signedUrl: string | null = null;
  let signedUrlError = false;
  if (procedimiento.file_path) {
    const result = await createProcedureSignedUrl(supabase, procedimiento.file_path);
    if (result.ok) {
      signedUrl = result.url;
    } else {
      signedUrlError = true;
      console.error('[ProcedimientoViewPage] error al generar signed URL:', result.error);
    }
  }

  const safeHtml = procedimiento.contenido_texto ? renderMarkdownToSafeHtml(procedimiento.contenido_texto) : null;

  const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-4">
      <Link href="/procedimientos" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft size={15} />
        {copy.procedimientos.backToList}
      </Link>

      <Card>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-secondary">{procedimiento.titulo}</h1>
            <p className="text-sm text-neutral mt-1">
              {procedimiento.categoria || copy.procedimientos.view.sinCategoria}
            </p>
          </div>
          {isAdmin && procedimiento.estado === 'archivado' && <StatusBadge status="archivado" />}
        </div>

        {isAdmin && procedimiento.estado === 'archivado' && (
          <div className="mb-4 text-sm text-neutral bg-surface border border-color-border rounded-lg px-3 py-2">
            {copy.procedimientos.view.archivadoAviso}
          </div>
        )}

        <div className="text-xs text-neutral mb-6">
          {copy.procedimientos.view.actualizadoLabel}: {dateFormatter.format(new Date(procedimiento.updated_at))}
        </div>

        {safeHtml ? (
          <div
            className="prose prose-sm max-w-none text-secondary [&_a]:text-primary [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-blue-700 transition-colors"
          >
            <FileDown size={16} />
            {copy.procedimientos.openFile}
          </a>
        ) : signedUrlError ? (
          <p className="text-sm text-error">{copy.procedimientos.view.archivoNoDisponible}</p>
        ) : (
          <p className="text-sm text-neutral">{copy.procedimientos.view.cargandoArchivo}</p>
        )}
      </Card>
    </div>
  );
}
