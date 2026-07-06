import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import type { FrancoAlertRow } from './francoAlerts';

type FrancoAlertPanelProps = {
  rows: FrancoAlertRow[];
};

// FB-F3-09: panel de lectura arriba del calendario (junto al dashboard de
// motivos), admin/supervisor únicamente — page.tsx no lo renderiza para
// empleado. Nivel 2 (segundo umbral, más urgente) en rojo; nivel 1 en
// ámbar, mismos tokens que "Próximos a vencer" de Fase 2.
const NIVEL_BADGE_CLASS: Record<1 | 2, string> = {
  1: 'bg-warning/10 text-warning border border-warning/30',
  2: 'bg-error/10 text-error border border-error/30',
};

export function FrancoAlertPanel({ rows }: FrancoAlertPanelProps) {
  const t = copy.calendario.alertasFranco;

  return (
    <Card padding="sm">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={18} className="text-warning shrink-0" />
        <div>
          <h2 className="text-base font-semibold text-secondary">{t.title}</h2>
          <p className="text-sm text-neutral mt-0.5">{t.subtitle}</p>
        </div>
      </div>

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
    </Card>
  );
}
