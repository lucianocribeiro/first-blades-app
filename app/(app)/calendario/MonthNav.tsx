import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { copy } from '@/lib/copy';
import { getAdjacentMonth, getCurrentYearMonth } from './utils';

type MonthNavProps = {
  year: number;
  month: number;
};

export function MonthNav({ year, month }: MonthNavProps) {
  const prev = getAdjacentMonth(year, month, -1);
  const next = getAdjacentMonth(year, month, 1);
  const current = getCurrentYearMonth();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link
          href={`/calendario?year=${prev.year}&month=${prev.month}`}
          aria-label={copy.calendario.nav.mesAnterior}
          className="p-2 rounded-lg border border-color-border text-neutral hover:bg-surface transition-colors"
        >
          <ChevronLeft size={16} />
        </Link>
        <span className="text-sm font-semibold text-secondary min-w-[140px] text-center">
          {copy.calendario.meses[month - 1]} {year}
        </span>
        <Link
          href={`/calendario?year=${next.year}&month=${next.month}`}
          aria-label={copy.calendario.nav.mesSiguiente}
          className="p-2 rounded-lg border border-color-border text-neutral hover:bg-surface transition-colors"
        >
          <ChevronRight size={16} />
        </Link>
      </div>
      <Link
        href={`/calendario?year=${current.year}&month=${current.month}`}
        className="text-sm text-primary font-medium hover:underline"
      >
        {copy.calendario.nav.hoy}
      </Link>
    </div>
  );
}
