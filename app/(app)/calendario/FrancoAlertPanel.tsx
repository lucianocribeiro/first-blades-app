import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import type { FrancoAlertRow } from './francoAlerts';

type FrancoAlertPanelProps = {
  rows: FrancoAlertRow[];
};

// FB-F3-09: tabla de empleados en alerta de franco, admin/supervisor
// únicamente — page.tsx no la renderiza para empleado. Nivel 2 (segundo
// umbral, más urgente) en rojo; nivel 1 en ámbar, mismos tokens que
// "Próximos a vencer" de Fase 2. FB-F3-11: sin Card/título propios — el
// CollapsibleSection que lo envuelve en CalendarioSections da el
// encabezado (con el contador de empleados en alerta); este componente es
// solo la tabla.
const NIVEL_BADGE_CLASS: Record<1 | 2, string> = {
  1: 'bg-warning/10 text-warning border border-warning/30',
  2: 'bg-error/10 text-error border border-error/30',
};

export function FrancoAlertPanel({ rows }: FrancoAlertPanelProps) {
  const t = copy.calendario.alertasFranco;

  return (
    <Table<FrancoAlertRow>
      columns={[
        {
          key: 'empleado',
          header: t.table.empleado,
          sticky: true,
          render: (row) => row.fullName || row.email,
        },
        {
          key: 'tipo',
          header: t.table.tipo,
          render: (row) => t.tipos[row.tipo],
        },
        {
          key: 'valor',
          header: t.table.valor,
          render: (row) => `${row.valor} ${t.diasLabel}`,
        },
        {
          key: 'umbral',
          header: t.table.umbral,
          render: (row) => (
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${NIVEL_BADGE_CLASS[row.nivel]}`}
            >
              {row.umbral}
            </span>
          ),
        },
      ]}
      rows={rows}
      keyExtractor={(row) => `${row.employeeId}-${row.tipo}`}
      emptyMessage={t.sinAlertas}
    />
  );
}
