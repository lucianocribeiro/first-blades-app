import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { ProcedimientoForm } from '../../ProcedimientoForm';
import type { Procedure } from '@/lib/db-types';

export default async function EditarProcedimientoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createServerClient();

  const [{ data, error }, { data: categoriasData }] = await Promise.all([
    supabase.from('procedures').select('*').eq('id', id).maybeSingle(),
    supabase.from('procedures').select('categoria').not('categoria', 'is', null),
  ]);

  if (error) {
    console.error('[EditarProcedimientoPage] error al cargar procedimiento:', error.message);
    notFound();
  }
  if (!data) notFound();

  const procedimiento = data as Procedure;
  const categoriaSuggestions = Array.from(
    new Set(((categoriasData ?? []) as { categoria: string | null }[]).map((c) => c.categoria).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b, 'es-AR'));

  return (
    <div className="space-y-4">
      <Link href={`/procedimientos/${id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft size={15} />
        {copy.procedimientos.backToList}
      </Link>

      <Card>
        <h1 className="text-lg font-semibold text-secondary mb-4">{copy.procedimientos.form.editarTitle}</h1>
        <ProcedimientoForm
          mode="editar"
          procedureId={procedimiento.id}
          categoriaSuggestions={categoriaSuggestions}
          initial={{
            titulo: procedimiento.titulo,
            categoria: procedimiento.categoria,
            contenidoTexto: procedimiento.contenido_texto,
            filePath: procedimiento.file_path,
          }}
        />
      </Card>
    </div>
  );
}
