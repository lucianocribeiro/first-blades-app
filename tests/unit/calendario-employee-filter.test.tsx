/**
 * Tests de render (Testing Library) — EmployeeFilter (FB-F3-11)
 *
 * Multiselect de empleados: sin selección muestra "todos"; abre un
 * listado de checkboxes; marcar/desmarcar actualiza la selección vía
 * onChange (el componente es controlado, no guarda estado propio de
 * selección); "Limpiar filtro" vacía la selección.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmployeeFilter } from '@/app/(app)/calendario/EmployeeFilter';
import { copy } from '@/lib/copy';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';

const EMPLOYEES: RosterEmployee[] = [
  { id: 'e1', full_name: 'Empleado Uno', email: 'e1@test.com' },
  { id: 'e2', full_name: 'Empleado Dos', email: 'e2@test.com' },
];

describe('EmployeeFilter (render)', () => {
  it('sin selección, el botón muestra "todos los empleados"', () => {
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={[]} onChange={vi.fn()} />);
    expect(screen.getByText(copy.calendario.filtroEmpleado.todos)).toBeInTheDocument();
  });

  it('con selección, el botón muestra la cantidad de seleccionados', () => {
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={['e1']} onChange={vi.fn()} />);
    expect(screen.getByText(`1 ${copy.calendario.filtroEmpleado.seleccionado}`)).toBeInTheDocument();
  });

  it('abre el listado al clickear el botón y muestra un checkbox por empleado', () => {
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: copy.calendario.filtroEmpleado.todos }));

    expect(screen.getByText('Empleado Uno')).toBeInTheDocument();
    expect(screen.getByText('Empleado Dos')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('marcar un checkbox invoca onChange agregando ese id', () => {
    const onChange = vi.fn();
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: copy.calendario.filtroEmpleado.todos }));
    fireEvent.click(screen.getByText('Empleado Uno'));

    expect(onChange).toHaveBeenCalledWith(['e1']);
  });

  it('desmarcar un checkbox ya seleccionado invoca onChange quitando ese id', () => {
    const onChange = vi.fn();
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={['e1', 'e2']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: `2 ${copy.calendario.filtroEmpleado.seleccionados}` }));
    fireEvent.click(screen.getByText('Empleado Uno'));

    expect(onChange).toHaveBeenCalledWith(['e2']);
  });

  it('"Limpiar filtro" solo aparece con selección, y vacía la selección al clickear', () => {
    const onChange = vi.fn();
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={['e1']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: `1 ${copy.calendario.filtroEmpleado.seleccionado}` }));

    const limpiar = screen.getByRole('button', { name: copy.calendario.filtroEmpleado.limpiar });
    expect(limpiar).toBeInTheDocument();
    fireEvent.click(limpiar);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('el botón principal expone aria-expanded y aria-haspopup', () => {
    render(<EmployeeFilter employees={EMPLOYEES} selectedIds={[]} onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: copy.calendario.filtroEmpleado.todos });
    expect(button).toHaveAttribute('aria-haspopup', 'listbox');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
