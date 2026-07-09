import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { copy } from '@/lib/copy';
import type { AusenciaRequest } from '@/lib/db-types';

function formatFecha(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR');
}

type Props = {
  requests: AusenciaRequest[];
};

export function MisSolicitudesTable({ requests }: Props) {
  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary mb-4">
        {copy.solicitudAusencia.listTitle}
      </h3>
      <Table
        columns={[
          {
            key: 'fecha',
            header: copy.solicitudAusencia.table.fecha,
            render: (r: AusenciaRequest) => formatFecha(r.fecha_inicio),
          },
          {
            key: 'nota',
            header: copy.solicitudAusencia.table.nota,
            render: (r: AusenciaRequest) => r.notas || '—',
          },
          {
            key: 'estado',
            header: copy.solicitudAusencia.table.estado,
            render: (r: AusenciaRequest) => (
              <StatusBadge status={r.estado} label={copy.solicitudAusencia.estados[r.estado]} />
            ),
          },
          {
            key: 'motivoRechazo',
            header: copy.solicitudAusencia.table.motivoRechazo,
            render: (r: AusenciaRequest) =>
              r.estado === 'rechazado' ? (r.motivo_rechazo ?? '—') : '—',
          },
        ]}
        rows={requests}
        keyExtractor={(r) => r.id}
        emptyMessage={copy.solicitudAusencia.noSolicitudes}
      />
    </Card>
  );
}
