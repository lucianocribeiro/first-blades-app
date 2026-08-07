import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { ProcedimientosSearchBar } from './ProcedimientosSearchBar';
import { ProcedimientosTable } from './ProcedimientosTable';
import type { Procedure } from '@/lib/db-types';

// Escapa caracteres especiales de PostgREST en el valor de un filtro
// ilike/or() — mismo criterio que app/(app)/mi-perfil/actions.ts.
function escapePostgrestFilter(s: string): string {
  return s.replace(/[(),."*\\]/g, '');
}

type SearchParams = { q?: string; categoria?: string; archivados?: string };

export default async function ProcedimientosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const profile = await requireAuth();
  const isAdmin = profile.role === 'admin';
  const { q, categoria, archivados } = await searchParams;

  const supabase = await createServerClient();

  const mostrarArchivados = isAdmin && archivados === '1';

  let query = supabase.from('procedures').select('*').order('updated_at', { ascending: false });

  // Filtro de app superpuesto a la RLS (no en su lugar): la RLS de
  // `procedures` ya oculta los archivados a no-admin, pero el filtro se
  // aplica igual acá — límites en dos capas, nunca solo en una.
  if (!mostrarArchivados) {
    query = query.eq('estado', 'vigente');
  }

  const search = (q ?? '').trim();
  if (search) {
    const safe = escapePostgrestFilter(search);
    if (safe) query = query.or(`titulo.ilike.%${safe}%,categoria.ilike.%${safe}%`);
  }

  const categoriaFiltro = (categoria ?? '').trim();
  if (categoriaFiltro) {
    query = query.eq('categoria', categoriaFiltro);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[ProcedimientosPage] error al cargar procedimientos:', error.message);
    return (
      <Card>
        <p className="text-error text-sm">{copy.procedimientos.errors.cargaError}</p>
      </Card>
    );
  }

  const procedimientos = (data ?? []) as Procedure[];

  // Categorías para el filtro: derivadas de lo que el usuario puede ver
  // (mismo criterio que el filtro de arriba — un no-admin no ve categorías
  // que solo existan en procedimientos archivados).
  const categoriasQuery = supabase.from('procedures').select('categoria').not('categoria', 'is', null);
  const { data: categoriasData } = mostrarArchivados
    ? await categoriasQuery
    : await categoriasQuery.eq('estado', 'vigente');
  const categorias = Array.from(
    new Set(((categoriasData ?? []) as { categoria: string | null }[]).map((c) => c.categoria).filter((c): c is string => !!c))
  ).sort((a, b) => a.localeCompare(b, 'es-AR'));

  const hasActiveFilters = !!search || !!categoriaFiltro;
  const emptyMessage = isAdmin
    ? hasActiveFilters
      ? copy.procedimientos.emptyState.adminSinResultados
      : copy.procedimientos.emptyState.adminSinNinguno
    : hasActiveFilters
      ? copy.procedimientos.emptyState.noAdminSinResultados
      : copy.procedimientos.emptyState.noAdminSinNinguno;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-secondary">{copy.pages.procedimientos.title}</h2>
          <p className="text-sm text-neutral mt-0.5">{copy.pages.procedimientos.subtitle}</p>
        </div>
        {isAdmin && (
          <Link
            href="/procedimientos/nuevo"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <PlusCircle size={16} />
            {copy.procedimientos.newButton}
          </Link>
        )}
      </div>

      <Card padding="sm">
        <div className="p-2">
          <ProcedimientosSearchBar
            categorias={categorias}
            isAdmin={isAdmin}
            initialQuery={search}
            initialCategoria={categoriaFiltro}
            initialMostrarArchivados={mostrarArchivados}
          />
        </div>
        <ProcedimientosTable
          procedimientos={procedimientos}
          isAdmin={isAdmin}
          emptyMessage={emptyMessage}
        />
      </Card>
    </div>
  );
}
