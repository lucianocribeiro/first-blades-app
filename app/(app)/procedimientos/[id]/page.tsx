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

  // Filtro de aplicación SUPERPUESTO a la RLS (FB-F5-AUD-05 Hallazgo 1) — no
  // es la defensa principal, la RLS (procedures_select) ya bloquea que un
  // no-admin lea un archivado. Es la segunda capa que las reglas técnicas
  // de FB-F5-06 piden explícitamente: si algún día la policy cambia o
  // alguien la rompe sin querer, esta línea sigue cortando acá también. No
  // borrar por "redundante" — es a propósito.
  let query = supabase.from('procedures').select('*').eq('id', id);
  if (!isAdmin) query = query.eq('estado', 'vigente');
  const { data, error } = await query.maybeSingle();

  // Mismo resultado (notFound) tanto si la fila no existe como si existe
  // pero está archivada y quien mira no es admin — no hay rama que
  // distinga los dos casos, así que no hay forma de deducir por el
  // mensaje si un id archivado existe.

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
