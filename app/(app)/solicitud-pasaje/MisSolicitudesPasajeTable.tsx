import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { copy } from '@/lib/copy';
import { formatDiasViaje, motivoViajeLabel } from '@/lib/rotation/pasaje-display';
import type { PasajeRequestWithEmpleado } from './page';

type Props = {
  requests: PasajeRequestWithEmpleado[];
  // FB-F4-15: "Mis solicitudes" ahora lista pasajes desde DOS perspectivas
  // (lo que pedí como solicitante, y lo que me pidieron como empleado
  // viajero) — se necesita saber quién está mirando para elegir el label
  // correcto por fila.
  viewerId: string;
};

function nombreDe(p: { full_name: string | null; email: string | null } | null | undefined): string {
  return p?.full_name || p?.email || '—';
}

// Perspectiva del viewer sobre CADA fila:
//  - Si el viewer es el solicitante: "—" cuando pidió para sí mismo
//    (solicitante_id === empleado_id), o "Para: <viajero>" cuando pidió
//    para otro integrante de su equipo.
//  - Si el viewer NO es el solicitante (es el empleado viajero, la fila le
//    llegó porque alguien más — su supervisor — pidió el pasaje para él):
//    "Pedido por: <solicitante>".
function paraQuienLabel(req: PasajeRequestWithEmpleado, viewerId: string): string {
  if (req.solicitante_id === viewerId) {
    if (req.solicitante_id === req.empleado_id) return '—';
    return `${copy.solicitudPasaje.detalle.paraLabel}: ${nombreDe(req.empleado_profile)}`;
  }
  return `${copy.solicitudPasaje.detalle.pedidoPorLabel}: ${nombreDe(req.solicitante_profile)}`;
}

export function MisSolicitudesPasajeTable({ requests, viewerId }: Props) {
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
            render: (r: PasajeRequestWithEmpleado) => paraQuienLabel(r, viewerId),
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
          {
            key: 'postAprobacion',
            header: copy.solicitudPasaje.table.postAprobacion,
            // FB-F4-14 §3.7 — mismo criterio que MisSolicitudesTable.tsx (ausencia).
            render: (r: PasajeRequestWithEmpleado) =>
              r.post_aprobacion_tipo ? (
                <div>
                  <StatusBadge status={r.post_aprobacion_tipo} />
                  {r.comentario_post_aprobacion && (
                    <div className="text-xs mt-1">{r.comentario_post_aprobacion}</div>
                  )}
                  {r.post_aprobacion_at && (
                    <div className="text-xs text-neutral mt-0.5">
                      {new Date(r.post_aprobacion_at).toLocaleString('es-AR')}
                    </div>
                  )}
                </div>
              ) : (
                '—'
              ),
          },
        ]}
        rows={requests}
        keyExtractor={(r) => r.id}
        emptyMessage={copy.solicitudPasaje.noSolicitudes}
      />
    </Card>
  );
}
