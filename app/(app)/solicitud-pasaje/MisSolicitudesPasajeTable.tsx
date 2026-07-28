import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { copy } from '@/lib/copy';
import { formatDiasViaje, motivoViajeLabel } from '@/lib/rotation/pasaje-display';
import type { PasajeRequestWithEmpleado } from './page';

type Props = {
  requests: PasajeRequestWithEmpleado[];
};

// "Para quién" solo se muestra cuando difiere del propio solicitante — un
// supervisor pidiendo para sí mismo no necesita ver su propio nombre repetido.
function empleadoLabel(req: PasajeRequestWithEmpleado): string {
  if (req.solicitante_id === req.empleado_id) return '—';
  const p = req.empleado_profile;
  return p?.full_name || p?.email || '—';
}

export function MisSolicitudesPasajeTable({ requests }: Props) {
  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary mb-4">
        {copy.solicitudPasaje.listTitle}
      </h3>
      <Table
        columns={[
          {
            key: 'empleado',
            header: copy.solicitudPasaje.table.empleado,
            render: (r: PasajeRequestWithEmpleado) => empleadoLabel(r),
          },
          {
            key: 'motivo',
            header: copy.solicitudPasaje.table.motivo,
            render: (r: PasajeRequestWithEmpleado) => motivoViajeLabel(r.motivo_viaje),
          },
          {
            key: 'recorrido',
            header: copy.solicitudPasaje.table.recorrido,
            render: (r: PasajeRequestWithEmpleado) => `${r.origen} → ${r.destino}`,
          },
          {
            key: 'dias',
            header: copy.solicitudPasaje.table.dias,
            render: (r: PasajeRequestWithEmpleado) => formatDiasViaje(r.dias_viaje ?? []),
          },
          {
            key: 'nota',
            header: copy.solicitudPasaje.table.nota,
            render: (r: PasajeRequestWithEmpleado) => r.notas || '—',
          },
          {
            key: 'estado',
            header: copy.solicitudPasaje.table.estado,
            render: (r: PasajeRequestWithEmpleado) => (
              <StatusBadge status={r.estado} label={copy.solicitudPasaje.estados[r.estado]} />
            ),
          },
          {
            key: 'motivoRechazo',
            header: copy.solicitudPasaje.table.motivoRechazo,
            render: (r: PasajeRequestWithEmpleado) =>
              r.estado === 'rechazado' ? (r.motivo_rechazo ?? '—') : '—',
          },
        ]}
        rows={requests}
        keyExtractor={(r) => r.id}
        emptyMessage={copy.solicitudPasaje.noSolicitudes}
      />
    </Card>
  );
}
