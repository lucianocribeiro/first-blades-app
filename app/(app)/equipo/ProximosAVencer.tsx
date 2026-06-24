import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';
import { getUrgencyBgClass, formatDate, formatDiasRestantes } from './utils';
import type { ExpiredDocRow } from './utils';

type Props = {
  rows: ExpiredDocRow[];
};

export function ProximosAVencer({ rows }: Props) {
  const t = copy.equipo.proximosAVencer;

  return (
    <Card padding="sm">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={18} className="text-warning shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-secondary">{t.title}</h3>
          <p className="text-xs text-neutral">{t.subtitle}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral py-2">{t.noItems}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-color-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-color-border">
                <th className="px-4 py-3 text-left font-semibold text-secondary whitespace-nowrap">
                  {t.table.empleado}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-secondary whitespace-nowrap">
                  {t.table.documento}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-secondary whitespace-nowrap">
                  {t.table.vencimiento}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-secondary whitespace-nowrap">
                  {t.table.diasRestantes}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.doc_id}
                  className={idx % 2 === 1 ? 'bg-surface/40' : 'bg-white'}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/empleado/${row.user_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.empleado_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral">{row.tipo_label}</td>
                  <td className="px-4 py-3 text-neutral">{formatDate(row.fecha_vencimiento)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getUrgencyBgClass(row.dias_restantes)}`}
                    >
                      {formatDiasRestantes(row.dias_restantes)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
