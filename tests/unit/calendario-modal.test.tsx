/**
 * Tests de render (Testing Library) — validación del modal de edición de
 * celda (FB-F3-05, cierra el bloqueante de cobertura de FB-F3-AUD-04).
 *
 * FB-F3-04 solo testeaba validateAssignmentInput como función pura; acá se
 * ejercita el formulario real: seleccionar "Fuera del trabajo" sin motivo
 * debe mostrar el error y bloquear el guardado (la action mockeada nunca
 * se invoca); lo mismo para motivo "otros" sin texto. La action del
 * servidor se mockea para no tocar Supabase/DB desde un test de componente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/(app)/calendario/actions', () => ({
  upsertRotationAssignment: vi.fn().mockResolvedValue(undefined),
}));

import { CellEditModal } from '@/app/(app)/calendario/CellEditModal';
import { upsertRotationAssignment } from '@/app/(app)/calendario/actions';
import { copy } from '@/lib/copy';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';

const EMPLOYEE: RosterEmployee = { id: 'emp-1', full_name: 'Ana Gómez', email: 'ana@test.com' };

function submitForm(container: HTMLElement) {
  const form = container.querySelector('#cell-edit-form');
  if (!form) throw new Error('No se encontró el form #cell-edit-form');
  fireEvent.submit(form);
}

describe('CellEditModal: validación de motivo obligatorio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('periodo_fuera_trabajo sin motivo bloquea el guardado y muestra el error', () => {
    const { container } = render(
      <CellEditModal employee={EMPLOYEE} fecha="2026-07-10" assignment={undefined} onClose={() => {}} />
    );

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });
    submitForm(container);

    expect(screen.getByText(copy.calendario.errors.motivoRequerido)).toBeInTheDocument();
    expect(upsertRotationAssignment).not.toHaveBeenCalled();
  });

  it('motivo "otros" sin texto bloquea el guardado y muestra el error', () => {
    const { container } = render(
      <CellEditModal employee={EMPLOYEE} fecha="2026-07-10" assignment={undefined} onClose={() => {}} />
    );

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });
    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.motivo, { exact: false }), {
      target: { value: 'otros' },
    });
    submitForm(container);

    expect(screen.getByText(copy.calendario.errors.motivoOtrosRequerido)).toBeInTheDocument();
    expect(upsertRotationAssignment).not.toHaveBeenCalled();
  });

  it('motivo "otros" con texto > 80 caracteres bloquea el guardado y muestra el error', () => {
    const { container } = render(
      <CellEditModal employee={EMPLOYEE} fecha="2026-07-10" assignment={undefined} onClose={() => {}} />
    );

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });
    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.motivo, { exact: false }), {
      target: { value: 'otros' },
    });
    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.motivoOtros, { exact: false }), {
      target: { value: 'x'.repeat(81) },
    });
    submitForm(container);

    expect(screen.getByText(copy.calendario.errors.motivoOtrosMaximo)).toBeInTheDocument();
    expect(upsertRotationAssignment).not.toHaveBeenCalled();
  });

  it('motivo válido (no "otros") pasa la validación e invoca la action', async () => {
    const { container } = render(
      <CellEditModal employee={EMPLOYEE} fecha="2026-07-10" assignment={undefined} onClose={() => {}} />
    );

    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.estado, { exact: false }), {
      target: { value: 'periodo_fuera_trabajo' },
    });
    fireEvent.change(screen.getByLabelText(copy.calendario.modal.fields.motivo, { exact: false }), {
      target: { value: 'vacaciones' },
    });
    submitForm(container);

    await waitFor(() => expect(upsertRotationAssignment).toHaveBeenCalledTimes(1));
    expect(upsertRotationAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'emp-1',
        fecha: '2026-07-10',
        estado_dia: 'periodo_fuera_trabajo',
        motivo_ausencia: 'vacaciones',
      })
    );
    expect(screen.queryByText(copy.calendario.errors.motivoRequerido)).not.toBeInTheDocument();
  });

  it('trabajando/en_viaje/en_franco no requieren motivo e invocan la action', async () => {
    const { container } = render(
      <CellEditModal employee={EMPLOYEE} fecha="2026-07-10" assignment={undefined} onClose={() => {}} />
    );

    // 'trabajando' es el default del Select — no hace falta cambiarlo.
    submitForm(container);

    await waitFor(() => expect(upsertRotationAssignment).toHaveBeenCalledTimes(1));
    expect(upsertRotationAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ estado_dia: 'trabajando', motivo_ausencia: null })
    );
  });
});
