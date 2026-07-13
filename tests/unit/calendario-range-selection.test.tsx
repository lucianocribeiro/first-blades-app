/**
 * Tests de render (Testing Library) — selección de rango por shift-click en
 * el roster (FB-F3-23). Ejercita la interacción real de click / shift-click
 * sobre RosterGrid: qué modal se monta y con qué datos. La action del
 * servidor se mockea (igual que calendario-modal.test.tsx) para no tocar
 * Supabase/DB desde un test de componente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/app/(app)/calendario/actions', () => ({
  upsertRotationAssignment: vi.fn().mockResolvedValue(undefined),
  upsertRotationRange: vi.fn().mockResolvedValue({ applied: [], failed: [] }),
}));

import { RosterGrid } from '@/app/(app)/calendario/RosterGrid';
import { copy } from '@/lib/copy';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';

const EMPLOYEES: RosterEmployee[] = [
  { id: 'emp-1', full_name: 'Ana Gómez', email: 'ana@test.com' },
  { id: 'emp-2', full_name: 'Beto Ruiz', email: 'beto@test.com' },
];

const DAYS = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];

function cell(nombre: string, fecha: string) {
  return screen.getByRole('button', { name: new RegExp(`^${nombre} — ${fecha} — `) });
}

describe('RosterGrid: selección de rango por shift-click (FB-F3-23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('click simple abre el modal de un día (sin regresión sobre FB-F3-05)', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'));

    expect(screen.getByText(copy.calendario.modal.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.range.modal.title)).not.toBeInTheDocument();
  });

  it('click + shift-click en la misma fila arma el rango intermedio y abre el modal de rango', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'));
    fireEvent.click(cell('Ana Gómez', '2026-07-03'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.range.modal.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.modal.title)).not.toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 – 2026-07-03/)).toBeInTheDocument();
    expect(screen.getByText(/\(3 /)).toBeInTheDocument();
  });

  it('el shift-click funciona en cualquier orden (ancla posterior a la fecha final)', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-03'));
    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.range.modal.title)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 – 2026-07-03/)).toBeInTheDocument();
  });

  it('shift-click en OTRA fila no arma rango: no cruza empleados', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'));
    fireEvent.click(cell('Beto Ruiz', '2026-07-02'), { shiftKey: true });

    expect(screen.queryByText(copy.calendario.range.modal.title)).not.toBeInTheDocument();
    expect(screen.getByText(copy.calendario.modal.title)).toBeInTheDocument();
  });

  it('shift-click sin click previo (sin ancla) se comporta como un click normal', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-02'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.modal.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.range.modal.title)).not.toBeInTheDocument();
  });

  it('shift-click dos veces sobre la MISMA celda (mismo ancla y destino) no arma rango de 1: cae al modal de un día', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-02'));
    fireEvent.click(cell('Ana Gómez', '2026-07-02'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.modal.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.range.modal.title)).not.toBeInTheDocument();
  });
});
