type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sticky?: boolean;
  width?: string;
};

import { copy } from '@/lib/copy';

type TableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  emptyMessage?: string;
  loading?: boolean;
};

export function Table<T>({
  columns,
  rows,
  keyExtractor,
  emptyMessage = copy.general.noData,
  loading = false,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-card border border-color-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-color-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  'px-4 py-3 text-left font-semibold text-secondary whitespace-nowrap',
                  col.sticky ? 'sticky left-0 bg-surface z-10' : '',
                  col.width ?? '',
                ].join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-neutral"
              >
                Cargando...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-neutral"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr
                key={keyExtractor(row)}
                className={idx % 2 === 1 ? 'bg-surface/40' : 'bg-white'}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      'px-4 py-3 text-neutral',
                      col.sticky ? 'sticky left-0 bg-white z-10' : '',
                    ].join(' ')}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
