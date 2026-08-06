'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { copy } from '@/lib/copy';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type ProcedimientosSearchBarProps = {
  categorias: string[];
  isAdmin: boolean;
  initialQuery: string;
  initialCategoria: string;
  initialMostrarArchivados: boolean;
};

// La búsqueda/filtro corre del lado del server (ilike en page.tsx, no
// filtrado en el cliente): este componente solo escribe query params en la
// URL y deja que la navegación dispare el re-fetch server-side. Debounce de
// 300ms en el texto libre para no disparar una navegación por cada tecla.
export function ProcedimientosSearchBar({
  categorias,
  isAdmin,
  initialQuery,
  initialCategoria,
  initialMostrarArchivados,
}: ProcedimientosSearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(initialQuery);

  function pushParams(next: { q?: string; categoria?: string; archivados?: boolean }) {
    const params = new URLSearchParams(searchParams.toString());

    const nextQ = next.q ?? initialQuery;
    const nextCategoria = next.categoria ?? initialCategoria;
    const nextArchivados = next.archivados ?? initialMostrarArchivados;

    if (nextQ) params.set('q', nextQ); else params.delete('q');
    if (nextCategoria) params.set('categoria', nextCategoria); else params.delete('categoria');
    if (nextArchivados) params.set('archivados', '1'); else params.delete('archivados');

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      if (q !== initialQuery) pushParams({ q });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
      <div className="flex-1">
        <Input
          icon={<Search size={16} />}
          placeholder={copy.procedimientos.search.placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="w-full sm:w-56">
        <Select
          label={copy.procedimientos.search.categoriaLabel}
          value={initialCategoria}
          onChange={(e) => pushParams({ categoria: e.target.value })}
          options={[
            { value: '', label: copy.procedimientos.search.categoriaTodas },
            ...categorias.map((c) => ({ value: c, label: c })),
          ]}
        />
      </div>
      {isAdmin && (
        <label className="flex items-center gap-2 text-sm text-secondary whitespace-nowrap pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={initialMostrarArchivados}
            onChange={(e) => pushParams({ archivados: e.target.checked })}
          />
          {copy.procedimientos.search.mostrarArchivados}
        </label>
      )}
    </div>
  );
}
