/**
 * Tests de render (Testing Library) — modal de pintado por rango (FB-F3-23).
 *
 * Ejercita el formulario real: validación de motivo obligatorio (reusa
 * validateAssignmentInput, misma regla que la celda única), exclusión de
 * "Día de trámite" de las opciones de motivo, y el reporte final
 * (aplicados/fallidos) que reemplaza el form tras enviar. La action del
 * servidor se mockea para no tocar Supabase/DB desde un test de componente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/(app)/calendario/actions', () => ({
  upsertRotationRange: vi.fn(),
}));

import { RangeEditModal } from '@/app/(app)/calendario/RangeEditModal';
import { upsertRotationRange } from '@/app/(app)/calendario/actions';
import { copy } from '@/lib/copy';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';

const EMPLOYEE: RosterEmployee = { id: 'emp-1', full_name: 'Ana Gómez', email: 'ana@test.com' };
const FECHAS = ['2026-07-10', '2026-07-11', '2026-07-12'];

// FB-F3-24: mismo formato de conteo en éxito total y en fallo parcial —
// "Se aplicaron N de N días." en vez de una frase distinta para el caso feliz.
function countSummary(applied: number, total: number): string {
  const r = copy.calendario.range.resultado;
  return `${r.aplicaronPrefijo} ${applied} ${r.de} ${total} ${total === 1 ? r.diaSingular : r.diasPlural}.`;
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector('#range-edit-form');
  if (!form) throw new Error('No se encontró el form #range-edit-form');
  fireEvent.submit(form);
}

describe('RangeEditModal: opciones de motivo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('NO ofrece "Día de trámite" como motivo (tiene su propio flujo gobernado, no se pinta por rango)', () => {
    render(<RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });

    const motivoSelect = screen.getByLabelText(copy.calendario.modal.fields.motivo, {
      exact: false,
    }) as HTMLSelectElement;
    const optionLabels = Array.from(motivoSelect.options).map((o) => o.textContent);

    expect(optionLabels).not.toContain(copy.calendario.motivos.dia_tramite);
    expect(optionLabels).toContain(copy.calendario.motivos.vacaciones);
  });
});

describe('RangeEditModal: validación de motivo obligatorio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('periodo_fuera_trabajo sin motivo bloquea el envío y muestra el error', () => {
    const { container } = render(
      <RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={() => {}} />
    );

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });
    submitForm(container);

    expect(screen.getByText(copy.calendario.errors.motivoRequerido)).toBeInTheDocument();
    expect(upsertRotationRange).not.toHaveBeenCalled();
  });

  it('motivo "otros" sin texto bloquea el envío y muestra el error', () => {
    const { container } = render(
      <RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={() => {}} />
    );

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });
    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.motivo, { exact: false }), {
      target: { value: 'otros' },
    });
    submitForm(container);

    expect(screen.getByText(copy.calendario.errors.motivoOtrosRequerido)).toBeInTheDocument();
    expect(upsertRotationRange).not.toHaveBeenCalled();
  });
});

describe('RangeEditModal: envío y reporte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rango feliz: invoca la action con user_id + fechas del rango, y muestra "N de N días" (FB-F3-24)', async () => {
    vi.mocked(upsertRotationRange).mockResolvedValue({ applied: FECHAS, failed: [] });

    const { container } = render(
      <RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={() => {}} />
    );
    // 'trabajando' es el default del Select — no requiere motivo.
    submitForm(container);

    await waitFor(() => expect(upsertRotationRange).toHaveBeenCalledTimes(1));
    expect(upsertRotationRange).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'emp-1', fechas: FECHAS, estado_dia: 'trabajando' })
    );

    expect(await screen.findByText(countSummary(FECHAS.length, FECHAS.length))).toBeInTheDocument();
  });

  it('fallo parcial: muestra el resumen "X de N" y lista el/los días fallidos con su motivo', async () => {
    vi.mocked(upsertRotationRange).mockResolvedValue({
      applied: ['2026-07-10', '2026-07-12'],
      failed: [{ fecha: '2026-07-11', motivo: copy.calendario.range.errors.permisoDenegado }],
    });

    const { container } = render(
      <RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={() => {}} />
    );
    submitForm(container);

    expect(await screen.findByText(countSummary(2, FECHAS.length))).toBeInTheDocument();
    expect(screen.getByText(copy.calendario.range.resultado.fallaronTitulo)).toBeInTheDocument();
    expect(container.textContent).toContain('2026-07-11');
    expect(container.textContent).toContain(copy.calendario.range.errors.permisoDenegado);
  });

  it('el botón "Cerrar" del reporte invoca onClose', async () => {
    vi.mocked(upsertRotationRange).mockResolvedValue({ applied: FECHAS, failed: [] });
    const onClose = vi.fn();

    const { container } = render(
      <RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={onClose} />
    );
    submitForm(container);

    const closeBtn = await screen.findByText(copy.calendario.range.modal.cerrar);
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('si la action rechaza (ej. dia_tramite forzado igual llega al server), muestra el error sin cerrar el modal', async () => {
    vi.mocked(upsertRotationRange).mockRejectedValue(
      new Error(copy.calendario.range.errors.diaTramiteNoDisponible)
    );

    const { container } = render(
      <RangeEditModal employee={EMPLOYEE} fechas={FECHAS} onClose={() => {}} />
    );
    submitForm(container);

    expect(await screen.findByText(copy.calendario.range.errors.diaTramiteNoDisponible)).toBeInTheDocument();
  });
});
