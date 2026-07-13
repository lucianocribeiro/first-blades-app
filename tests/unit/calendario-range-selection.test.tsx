/**
 * Tests de render (Testing Library) — selección de rango por shift-click en
 * el roster (FB-F3-23, redefinido en FB-F3-24).
 *
 * FB-F3-24 cierra el hallazgo Alto de FB-F3-AUD-23: en el navegador real,
 * CellEditModal usa <dialog>.showModal(), que inertiza la página — si fijar
 * el ancla de rango abriera ese modal, el segundo shift-click nunca podría
 * dispararse. Por eso el gesto que fija el ancla (shift-click) ahora NUNCA
 * monta CellEditModal — invariante que el primer test de este archivo
 * encoda directamente como guard de regresión.
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

function anyModalOpen() {
  return (
    screen.queryByText(copy.calendario.modal.title) !== null ||
    screen.queryByText(copy.calendario.range.modal.title) !== null
  );
}

describe('RosterGrid: click simple (sin regresión)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('click simple abre el modal de un día', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'));

    expect(screen.getByText(copy.calendario.modal.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.range.modal.title)).not.toBeInTheDocument();
  });
});

describe('RosterGrid: guard de regresión — fijar el ancla nunca monta un modal (FB-F3-24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el primer shift-click (fija el ancla) NO monta CellEditModal ni RangeEditModal', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });

    expect(anyModalOpen()).toBe(false);
  });

  it('la celda ancla queda con estado visual "seleccionado" (aria-pressed) sin abrir modal', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });

    expect(cell('Ana Gómez', '2026-07-01')).toHaveAttribute('aria-pressed', 'true');
    expect(anyModalOpen()).toBe(false);
  });
});

describe('RosterGrid: shift-click + shift-click arma el rango', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('segundo shift-click en la misma fila abre RangeEditModal con el rango correcto', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });
    fireEvent.click(cell('Ana Gómez', '2026-07-03'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.range.modal.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.modal.title)).not.toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 – 2026-07-03/)).toBeInTheDocument();
    expect(screen.getByText(/\(3 /)).toBeInTheDocument();
  });

  it('funciona en cualquier orden (ancla posterior a la fecha final)', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-03'), { shiftKey: true });
    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.range.modal.title)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 – 2026-07-03/)).toBeInTheDocument();
  });

  it('el ancla se limpia (aria-pressed) una vez que el rango se confirma', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });
    fireEvent.click(cell('Ana Gómez', '2026-07-03'), { shiftKey: true });

    expect(cell('Ana Gómez', '2026-07-01')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('RosterGrid: shift-click en otra fila resetea el ancla (no multi-fila)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no arma rango ni abre ningún modal; solo mueve el ancla a la nueva fila', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });
    fireEvent.click(cell('Beto Ruiz', '2026-07-02'), { shiftKey: true });

    expect(anyModalOpen()).toBe(false);
  });

  it('el ancla reseteada queda en la nueva fila: un shift-click posterior arma el rango ahí', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });
    fireEvent.click(cell('Beto Ruiz', '2026-07-02'), { shiftKey: true }); // resetea el ancla a Beto
    fireEvent.click(cell('Beto Ruiz', '2026-07-04'), { shiftKey: true });

    expect(screen.getByText(copy.calendario.range.modal.title)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-02 – 2026-07-04/)).toBeInTheDocument();
  });
});

describe('RosterGrid: cancelación del ancla pendiente', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Esc cancela el ancla: el siguiente shift-click fija una nueva ancla en vez de armar un rango', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(cell('Ana Gómez', '2026-07-03'), { shiftKey: true });

    expect(anyModalOpen()).toBe(false);
  });

  it('un click simple cancela el ancla pendiente: el shift-click siguiente empieza un rango nuevo', () => {
    render(<RosterGrid employees={EMPLOYEES} days={DAYS} assignments={[]} />);

    fireEvent.click(cell('Ana Gómez', '2026-07-01'), { shiftKey: true }); // fija ancla en 07-01
    fireEvent.click(cell('Ana Gómez', '2026-07-02')); // click simple: edita 07-02 y cancela el ancla
    fireEvent.click(cell('Ana Gómez', '2026-07-04'), { shiftKey: true }); // primer shift-click del nuevo rango

    // Si el ancla NO se hubiera cancelado, esto abriría RangeEditModal
    // (07-01 – 07-04). Como se canceló, solo fija una ancla nueva.
    expect(screen.queryByText(copy.calendario.range.modal.title)).not.toBeInTheDocument();
  });
});
