import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { ProcedimientoForm } from '../ProcedimientoForm';

export default async function NuevoProcedimientoPage() {
  await requireAdmin();

  const supabase = await createServerClient();
  const { data } = await supabase.from('procedures').select('categoria').not('categoria', 'is', null);
  const categoriaSuggestions = Array.from(
    new Set(((data ?? []) as { categoria: string | null }[]).map((c) => c.categoria).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b, 'es-AR'));

  return (
    <div className="space-y-4">
      <Link href="/procedimientos" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft size={15} />
        {copy.procedimientos.backToList}
      </Link>

      <Card>
        <h1 className="text-lg font-semibold text-secondary mb-4">{copy.procedimientos.form.crearTitle}</h1>
        <ProcedimientoForm mode="crear" categoriaSuggestions={categoriaSuggestions} />
      </Card>
    </div>
  );
}
