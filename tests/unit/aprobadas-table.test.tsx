/**
 * FB-F4-14 — AprobadasTable: render de la vista de Solicitudes Aprobadas.
 *
 * Cubre, con render real (Testing Library) y las server actions mockeadas
 * (no se invocan salvo donde el test lo dice explícitamente):
 *  - Marca post-aprobación: sin cambios → '—'; con cambio → badge + comentario
 *    + timestamp visibles.
 *  - Vigencia: una solicitud 'cancelada' NO muestra los botones
 *    Cancelar/Editar fechas (la RPC las rechazaría); una vigente sí.
 *  - Filtro por empleado: reduce las filas mostradas a las del empleado
 *    elegido; "Todos los empleados" las vuelve a mostrar todas.
 *  - Vacío: sin ítems, muestra el copy de "no hay aprobadas".
 */

import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/app/(app)/aprobadas/actions', () => ({
  cancelarAusencia: vi.fn(),
  editarFechasAusencia: vi.fn(),
  cancelarPasaje: vi.fn(),
  editarFechasPasaje: vi.fn(),
  previewOverwriteAusencia: vi.fn(),
  previewOverwritePasaje: vi.fn(),
}));

import { AprobadasTable, type AprobadaItem } from '@/app/(app)/aprobadas/AprobadasTable';
import { copy } from '@/lib/copy';
import type { AusenciaRequest, PasajeRequest } from '@/lib/db-types';

function ausenciaItem(overrides: Partial<AusenciaRequest> = {}, empleadoId = 'emp-1'): AprobadaItem {
  return {
    kind: 'ausencia',
    data: {
      id: 'req-ausencia-1',
      user_id: empleadoId,
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
      user_profile: { full_name: `Empleado ${empleadoId}`, email: `${empleadoId}@test.com` },
      ...overrides,
    } as unknown as AusenciaRequest & { user_profile: { full_name: string; email: string } },
  };
}

function pasajeItem(overrides: Partial<PasajeRequest> = {}, empleadoId = 'emp-2'): AprobadaItem {
  return {
    kind: 'pasaje',
    data: {
      id: 'req-pasaje-1',
      solicitante_id: empleadoId,
      empleado_id: empleadoId,
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
      solicitante_profile: { full_name: `Empleado ${empleadoId}`, email: `${empleadoId}@test.com` },
      empleado_profile: { full_name: `Empleado ${empleadoId}`, email: `${empleadoId}@test.com` },
      ...overrides,
    } as unknown as PasajeRequest & {
      solicitante_profile: { full_name: string; email: string };
      empleado_profile: { full_name: string; email: string };
    },
  };
}

describe('AprobadasTable: marca post-aprobación', () => {
  it('sin cambios: muestra el guion de "sin cambios", sin badge ni comentario', () => {
    render(<AprobadasTable items={[ausenciaItem()]} employees={[]} />);
    expect(screen.getByText(copy.aprobadas.marca.sinCambios)).toBeInTheDocument();
  });

  it('con cambio: muestra el badge, el comentario y el timestamp', () => {
    render(
      <AprobadasTable
        items={[
          ausenciaItem({
            post_aprobacion_tipo: 'cancelada',
            comentario_post_aprobacion: 'El empleado renunció',
            post_aprobacion_at: '2027-02-01T10:00:00Z',
          }),
        ]}
        employees={[]}
      />
    );
    expect(screen.getByText(copy.status.cancelada)).toBeInTheDocument();
    expect(screen.getByText('El empleado renunció')).toBeInTheDocument();
  });
});

describe('AprobadasTable: vigencia — botones de acción', () => {
  it('vigente (sin marca): muestra Cancelar y Editar fechas', () => {
    render(<AprobadasTable items={[ausenciaItem()]} employees={[]} />);
    expect(screen.getByRole('button', { name: copy.aprobadas.actions.cancelar })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.aprobadas.actions.editarFechas })).toBeInTheDocument();
  });

  it('vigente (editada): sigue mostrando Cancelar y Editar fechas — solo cancelada bloquea', () => {
    render(<AprobadasTable items={[ausenciaItem({ post_aprobacion_tipo: 'editada' })]} employees={[]} />);
    expect(screen.getByRole('button', { name: copy.aprobadas.actions.cancelar })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.aprobadas.actions.editarFechas })).toBeInTheDocument();
  });

  it('cancelada: NO muestra ni Cancelar ni Editar fechas (la RPC las rechazaría)', () => {
    render(<AprobadasTable items={[ausenciaItem({ post_aprobacion_tipo: 'cancelada' })]} employees={[]} />);
    expect(screen.queryByRole('button', { name: copy.aprobadas.actions.cancelar })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.aprobadas.actions.editarFechas })).not.toBeInTheDocument();
  });
});

describe('AprobadasTable: filtro por empleado', () => {
  it('filtra las filas al empleado elegido, y "Todos" las vuelve a mostrar', () => {
    render(
      <AprobadasTable
        items={[ausenciaItem({}, 'emp-1'), pasajeItem({}, 'emp-2')]}
        employees={[
          { id: 'emp-1', label: 'Empleado emp-1' },
          { id: 'emp-2', label: 'Empleado emp-2' },
        ]}
      />
    );

    // Ambas filas visibles al arrancar (sin filtro).
    expect(screen.getAllByText(copy.aprobadas.marca.sinCambios)).toHaveLength(2);

    const select = screen.getByLabelText(copy.aprobadas.filtro.label);
    fireEvent.change(select, { target: { value: 'emp-1' } });
    expect(screen.getAllByText(copy.aprobadas.marca.sinCambios)).toHaveLength(1);

    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getAllByText(copy.aprobadas.marca.sinCambios)).toHaveLength(2);
  });
});

describe('AprobadasTable: vacío', () => {
  it('sin ítems, muestra el copy de "no hay aprobadas"', () => {
    render(<AprobadasTable items={[]} employees={[]} />);
    expect(screen.getByText(copy.aprobadas.noItems)).toBeInTheDocument();
  });
});
