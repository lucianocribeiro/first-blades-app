import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import { MOTIVOS_DASHBOARD, type MotivoDashboardRow } from './utils';

type MotivoDashboardProps = {
  rows: MotivoDashboardRow[];
};

// FB-F3-08: panel de lectura arriba de la grilla. Tabla empleado × 6
// motivos fijos (siempre presentes, con 0) + total, del mes visible.
// Comparte el mismo scope de `employees`/`assignments` ya resuelto por rol
// en page.tsx — no hace ninguna query propia.
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
    <Card padding="sm">
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-secondary">{copy.calendario.dashboard.title}</h2>
          <p className="text-sm text-neutral mt-0.5">{copy.calendario.dashboard.subtitle}</p>
        </div>
        <Table<MotivoDashboardRow>
          columns={columns}
          rows={rows}
          keyExtractor={(row) => row.employeeId}
          emptyMessage={copy.calendario.noEmpleados}
        />
      </div>
    </Card>
  );
}
