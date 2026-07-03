/**
 * Tests de render (Testing Library) — grilla del roster y leyenda (FB-F3-05,
 * cierra el bloqueante de cobertura de FB-F3-AUD-04).
 *
 * FB-F3-04 solo cubría la lógica pura de app/(app)/calendario/utils.ts;
 * acá se renderiza el DOM real para verificar filas × columnas, el color
 * gris de la celda sin cargar, el tono claro de una celda estimada y que
 * la leyenda muestra sus 6 entradas (4 estados + sin cargar + estimado).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RosterGrid } from '@/app/(app)/calendario/RosterGrid';
import { Legend } from '@/app/(app)/calendario/Legend';
import { copy } from '@/lib/copy';
import type { RotationAssignment } from '@/lib/db-types';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';

const EMPLOYEES: RosterEmployee[] = [
  { id: 'emp-1', full_name: 'Ana Gómez', email: 'ana@test.com' },
  { id: 'emp-2', full_name: 'Beto Ruiz', email: 'beto@test.com' },
];

const DAYS = ['2026-07-01', '2026-07-02'];

function makeAssignment(overrides: Partial<RotationAssignment> = {}): RotationAssignment {
  return {
    id: 'a1',
    user_id: 'emp-1',
    fecha: '2026-07-01',
    estado_dia: 'trabajando',
    es_estimado: false,
    motivo_ausencia: null,
    motivo_otros_texto: null,
    notas: null,
    rotation_group_id: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('RosterGrid (render)', () => {
  it('renderiza una fila por empleado y una columna por día', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    expect(screen.getByText('Ana Gómez')).toBeInTheDocument();
    expect(screen.getByText('Beto Ruiz')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '2' })).toBeInTheDocument();
    // 2 empleados × 2 días = 4 celdas-botón
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('celda sin asignación se ve en gris (default, no es un estado)', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    const cell = screen.getByRole('button', {
      name: `Ana Gómez — 2026-07-01 — ${copy.calendario.leyenda.sinCargar}`,
    });
    expect(cell.className).toContain('bg-calendar-vacio');
  });

  it('celda con estado real (es_estimado=false) usa el color sólido del estado', () => {
    const assignments = [
      makeAssignment({ user_id: 'emp-1', fecha: '2026-07-01', estado_dia: 'en_franco', es_estimado: false }),
    ];
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={assignments} />);

    const cell = screen.getByRole('button', {
      name: `Ana Gómez — 2026-07-01 — ${copy.status.en_franco}`,
    });
    expect(cell.className).toContain('bg-calendar-enFranco');
    expect(cell.className).not.toContain('bg-calendar-enFranco/35');
  });

  it('celda estimada (es_estimado=true) se ve en tono más claro (mismo color, opacidad reducida)', () => {
    const assignments = [
      makeAssignment({ user_id: 'emp-1', fecha: '2026-07-01', estado_dia: 'en_franco', es_estimado: true }),
    ];
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={assignments} />);

    const cell = screen.getByRole('button', {
      name: `Ana Gómez — 2026-07-01 — ${copy.status.en_franco}`,
    });
    expect(cell.className).toContain('bg-calendar-enFranco/35');
  });

  it('sin empleados activos muestra el mensaje vacío en vez de la grilla', () => {
    render(<RosterGrid employees={[]} days={DAYS} assignments={[]} />);
    expect(screen.getByText(copy.calendario.noEmpleados)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Legend (render)', () => {
  it('muestra los 4 estados + sin cargar + estimado', () => {
    render(<Legend />);

    expect(screen.getByText(copy.status.trabajando)).toBeInTheDocument();
    expect(screen.getByText(copy.status.en_viaje)).toBeInTheDocument();
    expect(screen.getByText(copy.status.en_franco)).toBeInTheDocument();
    expect(screen.getByText(copy.status.periodo_fuera_trabajo)).toBeInTheDocument();
    expect(screen.getByText(copy.calendario.leyenda.sinCargar)).toBeInTheDocument();
    expect(screen.getByText(copy.calendario.leyenda.estimado)).toBeInTheDocument();
  });
});
