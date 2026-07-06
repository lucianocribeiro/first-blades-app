import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import { MOTIVOS_DASHBOARD, type MotivoDashboardRow } from './utils';

type MotivoDashboardProps = {
  rows: MotivoDashboardRow[];
};

// FB-F3-08: tabla empleado × 6 motivos fijos (siempre presentes, con 0) +
// total, del mes visible. Comparte el mismo scope de
// `employees`/`assignments` ya resuelto por rol en page.tsx — no hace
// ninguna query propia. FB-F3-11: sin Card/título propios — el
// CollapsibleSection que lo envuelve en CalendarioSections da el
// encabezado; este componente es solo la tabla.
export function MotivoDashboard({ rows }: MotivoDashboardProps) {
  const columns = [
    {
      key: 'empleado',
      header: copy.calendario.table.empleado,
      sticky: true,
      render: (row: MotivoDashboardRow) => row.fullName || row.email,
    },
    ...MOTIVOS_DASHBOARD.map((motivo) => ({
      key: motivo,
      header: copy.calendario.motivos[motivo],
      render: (row: MotivoDashboardRow) => row.counts[motivo],
    })),
    {
      key: 'total',
      header: copy.calendario.dashboard.total,
      render: (row: MotivoDashboardRow) => row.total,
    },
  ];

  return (
    <Table<MotivoDashboardRow>
      columns={columns}
      rows={rows}
      keyExtractor={(row) => row.employeeId}
      emptyMessage={copy.calendario.noEmpleados}
    />
  );
}
