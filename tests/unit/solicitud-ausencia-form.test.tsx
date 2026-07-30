/**
 * Tests de render (Testing Library) — formulario unificado de Solicitud de
 * Ausencia (FB-F4-05): el desplegable de motivo controla qué campos se
 * muestran (motivo_otros_texto solo con 'otros', saldo de día de trámite
 * solo con 'dia_tramite'), y la validación de cliente (solo UX; la
 * autoridad real es server-side, ver tests/unit/solicitud-ausencia.test.ts)
 * bloquea el envío ante datos incompletos.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// FB-F4-16: createAusenciaRequest devuelve { ok, error } en vez de tirar.
vi.mock('@/app/(app)/solicitud-ausencia/actions', () => ({
  createAusenciaRequest: vi.fn().mockResolvedValue({ ok: true }),
}));

import { SolicitudAusenciaForm } from '@/app/(app)/solicitud-ausencia/SolicitudAusenciaForm';
import { createAusenciaRequest } from '@/app/(app)/solicitud-ausencia/actions';
import { copy } from '@/lib/copy';
import type { SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';

const SALDO: SaldoDiasTramite = {
  employeeId: 'emp-1',
  fullName: 'Empleado Test',
  email: 'emp@test.com',
  consumidos: 1,
  restantes: 2,
  excedido: false,
  fechas: [{ fecha: '2027-01-05', esEstimado: false }],
};

const MANANA = '2027-06-16';

function submitForm(container: HTMLElement) {
  const form = container.querySelector('form');
  if (!form) throw new Error('No se encontró el <form>');
  fireEvent.submit(form);
}

function selectMotivo(value: string) {
  fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.motivo, { exact: false }), {
    target: { value },
  });
}

describe('SolicitudAusenciaForm: motivo_otros_texto condicional', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin motivo seleccionado, no muestra el campo de detalle del motivo ('otros')", () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    expect(screen.queryByLabelText(copy.solicitudAusencia.fields.motivoOtros, { exact: false })).not.toBeInTheDocument();
  });

  it("con un motivo distinto de 'otros', no muestra el campo de detalle", () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('vacaciones');
    expect(screen.queryByLabelText(copy.solicitudAusencia.fields.motivoOtros, { exact: false })).not.toBeInTheDocument();
  });

  it("con motivo 'otros', muestra el campo de detalle del motivo", () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('otros');
    expect(screen.getByLabelText(copy.solicitudAusencia.fields.motivoOtros, { exact: false })).toBeInTheDocument();
  });

  it("motivo 'otros' sin completar el detalle bloquea el envío y muestra el error", () => {
    const { container } = render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('otros');
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaInicio, { exact: false }), {
      target: { value: MANANA },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaFin, { exact: false }), {
      target: { value: MANANA },
    });
    submitForm(container);

    expect(screen.getByText(copy.solicitudAusencia.errors.motivoOtrosRequerido)).toBeInTheDocument();
    expect(createAusenciaRequest).not.toHaveBeenCalled();
  });

  it("motivo 'otros' con detalle completo envía motivoOtrosTexto trimeado", async () => {
    const { container } = render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('otros');
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaInicio, { exact: false }), {
      target: { value: MANANA },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaFin, { exact: false }), {
      target: { value: MANANA },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.motivoOtros, { exact: false }), {
      target: { value: '  Trámite médico  ' },
    });
    submitForm(container);

    await waitFor(() => expect(createAusenciaRequest).toHaveBeenCalledTimes(1));
    expect(createAusenciaRequest).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'otros', motivoOtrosTexto: 'Trámite médico' })
    );
  });
});

describe('SolicitudAusenciaForm: saldo de día de trámite condicional', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin motivo seleccionado, no muestra la card de saldo', () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    expect(screen.queryByText(copy.solicitudAusencia.saldo.title)).not.toBeInTheDocument();
  });

  it("con un motivo distinto de 'dia_tramite', no muestra la card de saldo", () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('vacaciones');
    expect(screen.queryByText(copy.solicitudAusencia.saldo.title)).not.toBeInTheDocument();
  });

  it("con motivo 'dia_tramite', muestra la card de saldo con el consumo real", () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('dia_tramite');
    expect(screen.getByText(copy.solicitudAusencia.saldo.title)).toBeInTheDocument();
    expect(screen.getByText(`${copy.solicitudAusencia.saldo.restantesPrefix} 2 ${copy.solicitudAusencia.saldo.restantesSufijo}`)).toBeInTheDocument();
  });

  it("con motivo 'dia_tramite', no muestra el campo de fecha de fin (fecha_fin sigue a fecha_inicio)", () => {
    render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('dia_tramite');
    expect(screen.queryByLabelText(copy.solicitudAusencia.fields.fechaFin, { exact: false })).not.toBeInTheDocument();
  });

  it("motivo 'dia_tramite': envía fecha_fin = fecha_inicio automáticamente", async () => {
    const { container } = render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('dia_tramite');
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaInicio, { exact: false }), {
      target: { value: MANANA },
    });
    submitForm(container);

    await waitFor(() => expect(createAusenciaRequest).toHaveBeenCalledTimes(1));
    expect(createAusenciaRequest).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'dia_tramite', fechaInicio: MANANA, fechaFin: MANANA })
    );
  });
});

describe('SolicitudAusenciaForm: validación de cliente (UX, no autoridad)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sin motivo seleccionado, bloquea el envío con el error de motivo requerido', () => {
    const { container } = render(<SolicitudAusenciaForm saldo={SALDO} />);
    submitForm(container);

    expect(screen.getByText(copy.solicitudAusencia.errors.motivoRequerido)).toBeInTheDocument();
    expect(createAusenciaRequest).not.toHaveBeenCalled();
  });

  it('rango con fecha_fin anterior a fecha_inicio bloquea el envío', () => {
    const { container } = render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('vacaciones');
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaInicio, { exact: false }), {
      target: { value: '2027-07-10' },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaFin, { exact: false }), {
      target: { value: '2027-07-05' },
    });
    submitForm(container);

    expect(screen.getByText(copy.solicitudAusencia.errors.fechaFinAnteriorAInicio)).toBeInTheDocument();
    expect(createAusenciaRequest).not.toHaveBeenCalled();
  });

  it('envío válido de un rango (vacaciones) invoca la action con el rango completo y limpia el formulario', async () => {
    const { container } = render(<SolicitudAusenciaForm saldo={SALDO} />);
    selectMotivo('vacaciones');
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaInicio, { exact: false }), {
      target: { value: '2027-07-01' },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudAusencia.fields.fechaFin, { exact: false }), {
      target: { value: '2027-07-05' },
    });
    submitForm(container);

    await waitFor(() => expect(createAusenciaRequest).toHaveBeenCalledTimes(1));
    expect(createAusenciaRequest).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'vacaciones', fechaInicio: '2027-07-01', fechaFin: '2027-07-05' })
    );
    await waitFor(() => expect(screen.getByText(copy.solicitudAusencia.messages.success)).toBeInTheDocument());
  });
});
