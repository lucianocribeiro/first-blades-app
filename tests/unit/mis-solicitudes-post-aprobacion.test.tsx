/**
 * FB-F4-14 §3.7 — Visibilidad in-app del cambio post-aprobación en la
 * propia vista del empleado (MisSolicitudesTable / MisSolicitudesPasajeTable):
 * representación en pantalla del mismo aviso que ya recibió por mail, para
 * que el empleado entienda el porqué sin depender de haber visto ese correo.
 *
 *  - Sin cambio (post_aprobacion_tipo NULL) → columna muestra '—'.
 *  - Con cambio → badge (editada/cancelada) + comentario + timestamp.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MisSolicitudesTable } from '@/app/(app)/solicitud-ausencia/MisSolicitudesTable';
import { MisSolicitudesPasajeTable } from '@/app/(app)/solicitud-pasaje/MisSolicitudesPasajeTable';
import { copy } from '@/lib/copy';
import type { AusenciaRequest } from '@/lib/db-types';
import type { PasajeRequestWithEmpleado } from '@/app/(app)/solicitud-pasaje/page';

function ausenciaRequest(overrides: Partial<AusenciaRequest> = {}): AusenciaRequest {
  return {
    id: 'req-1',
    user_id: 'emp-1',
    motivo_ausencia: 'vacaciones',
    motivo_otros_texto: null,
    fecha_inicio: '2027-03-15',
    fecha_fin: '2027-03-17',
    notas: null,
    estado: 'aprobado',
    motivo_rechazo: null,
    reviewed_by: 'admin-1',
    reviewed_at: '2027-01-01T00:00:00Z',
    created_at: '2027-01-01T00:00:00Z',
    updated_at: '2027-01-01T00:00:00Z',
    post_aprobacion_tipo: null,
    comentario_post_aprobacion: null,
    post_aprobacion_at: null,
    ...overrides,
  } as unknown as AusenciaRequest;
}

function pasajeRequest(overrides: Partial<PasajeRequestWithEmpleado> = {}): PasajeRequestWithEmpleado {
  return {
    id: 'req-2',
    solicitante_id: 'emp-1',
    empleado_id: 'emp-1',
    motivo_viaje: 'traslado_proyectos',
    fecha_viaje: '2027-04-01',
    origen: 'Base',
    destino: 'Sitio',
    dias_viaje: ['2027-04-01'],
    notas: null,
    estado: 'aprobado',
    motivo_rechazo: null,
    reviewed_by: 'admin-1',
    reviewed_at: '2027-01-01T00:00:00Z',
    created_at: '2027-01-01T00:00:00Z',
    updated_at: '2027-01-01T00:00:00Z',
    post_aprobacion_tipo: null,
    comentario_post_aprobacion: null,
    post_aprobacion_at: null,
    empleado_profile: null,
    ...overrides,
  } as unknown as PasajeRequestWithEmpleado;
}

describe('MisSolicitudesTable: marca post-aprobación (ausencia)', () => {
  it('sin cambio: la columna existe y no hay badge de post-aprobación', () => {
    render(<MisSolicitudesTable requests={[ausenciaRequest()]} />);
    expect(screen.getByText(copy.solicitudAusencia.table.postAprobacion)).toBeInTheDocument();
    expect(screen.queryByText(copy.status.cancelada)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.status.editada)).not.toBeInTheDocument();
  });

  it('cancelada: muestra el badge, el comentario y el timestamp', () => {
    render(
      <MisSolicitudesTable
        requests={[
          ausenciaRequest({
            post_aprobacion_tipo: 'cancelada',
            comentario_post_aprobacion: 'Cambio de planificación',
            post_aprobacion_at: '2027-02-01T10:00:00Z',
          }),
        ]}
      />
    );
    expect(screen.getByText(copy.status.cancelada)).toBeInTheDocument();
    expect(screen.getByText('Cambio de planificación')).toBeInTheDocument();
  });

  it('editada: muestra el badge de editada', () => {
    render(
      <MisSolicitudesTable
        requests={[
          ausenciaRequest({
            post_aprobacion_tipo: 'editada',
            comentario_post_aprobacion: 'Nuevas fechas',
            post_aprobacion_at: '2027-02-01T10:00:00Z',
          }),
        ]}
      />
    );
    expect(screen.getByText(copy.status.editada)).toBeInTheDocument();
    expect(screen.getByText('Nuevas fechas')).toBeInTheDocument();
  });
});

describe('MisSolicitudesPasajeTable: marca post-aprobación (pasaje)', () => {
  it('sin cambio: la columna existe y no hay badge de post-aprobación', () => {
    render(<MisSolicitudesPasajeTable requests={[pasajeRequest()]} viewerId="emp-1" />);
    expect(screen.getByText(copy.solicitudPasaje.table.postAprobacion)).toBeInTheDocument();
    expect(screen.queryByText(copy.status.cancelada)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.status.editada)).not.toBeInTheDocument();
  });

  it('cancelado: muestra el badge, el comentario y el timestamp', () => {
    render(
      <MisSolicitudesPasajeTable
        requests={[
          pasajeRequest({
            post_aprobacion_tipo: 'cancelada',
            comentario_post_aprobacion: 'Viaje suspendido',
            post_aprobacion_at: '2027-02-01T10:00:00Z',
          }),
        ]}
        viewerId="emp-1"
      />
    );
    expect(screen.getByText(copy.status.cancelada)).toBeInTheDocument();
    expect(screen.getByText('Viaje suspendido')).toBeInTheDocument();
  });

  // FB-F4-15: el mismo caso, pero ahora la solicitud la pidió otra persona
  // (un supervisor) — el empleado viajero SIGUE viendo la marca, y la
  // columna "para quién" identifica quién la pidió, no a sí mismo.
  it('FB-F4-15: pedido por otra persona (supervisor) — el viajero ve la marca y "Pedido por"', () => {
    render(
      <MisSolicitudesPasajeTable
        requests={[
          pasajeRequest({
            solicitante_id: 'sup-1',
            empleado_id: 'emp-1',
            solicitante_profile: { full_name: 'Supervisor Test', email: 'sup@test.com' },
            post_aprobacion_tipo: 'cancelada',
            comentario_post_aprobacion: 'Viaje suspendido',
            post_aprobacion_at: '2027-02-01T10:00:00Z',
          }),
        ]}
        viewerId="emp-1"
      />
    );
    expect(screen.getByText(copy.status.cancelada)).toBeInTheDocument();
    expect(screen.getByText('Viaje suspendido')).toBeInTheDocument();
    expect(
      screen.getByText(`${copy.solicitudPasaje.detalle.pedidoPorLabel}: Supervisor Test`)
    ).toBeInTheDocument();
  });
});
