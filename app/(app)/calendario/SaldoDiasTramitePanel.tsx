import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import type { SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';

type SaldoDiasTramitePanelProps = {
  rows: SaldoDiasTramite[];
};

// FB-F3-21: tabla empleado × (usados/restantes) del año en curso, admin/
// supervisor únicamente — page.tsx no la renderiza para empleado. A
// diferencia de MotivoDashboard (que es del mes visible), este panel es
// anual y no depende del mes que esté navegando la grilla. Sin Card/título
// propios — el CollapsibleSection que lo envuelve en CalendarioSections da
// el encabezado.
export function SaldoDiasTramitePanel({ rows }: SaldoDiasTramitePanelProps) {
  const t = copy.calendario.saldoDiasTramite;

  return (
    <Table<SaldoDiasTramite>
      columns={[
        {
          key: 'empleado',
          header: t.table.empleado,
          sticky: true,
          render: (row) => row.fullName || row.email,
        },
        {
          key: 'usados',
          header: t.table.usados,
          render: (row) => row.consumidos,
        },
        {
          key: 'restantes',
          header: t.table.restantes,
          render: (row) => row.restantes,
        },
        {
          key: 'estado',
          header: t.table.estado,
          render: (row) => (
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                row.excedido
                  ? 'bg-error/10 text-error border border-error/30'
                  : 'bg-success/10 text-success border border-success/30'
              }`}
            >
              {row.excedido ? t.estados.excedido : t.estados.disponible}
            </span>
          ),
        },
      ]}
      rows={rows}
      keyExtractor={(row) => row.employeeId}
      emptyMessage={t.sinEmpleados}
    />
  );
}
