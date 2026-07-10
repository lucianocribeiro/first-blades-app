/**
 * FB-F3-19 — Emails de resolución de solicitud de ausencia (día de trámite).
 *
 * Cubre, con el transporte de Gmail SIEMPRE mockeado (ningún test toca la red):
 *  - Builders de aprobación/rechazo (fecha, nombre, motivo, copy es-AR).
 *  - Escaping de HTML en valores dinámicos.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAusenciaApprovalEmail,
  buildAusenciaRejectionEmail,
} from '@/lib/email/ausencia-resolution-email';
import { copy } from '@/lib/copy';

describe('buildAusenciaApprovalEmail: contenido es-AR', () => {
  it('arma subject/text/html con la fecha formateada es-AR', () => {
    const email = buildAusenciaApprovalEmail({
      to: 'empleado@test.com',
      fullName: 'Juan Pérez',
      fechaInicio: '2027-03-15',
    });

    expect(email.to).toBe('empleado@test.com');
    expect(email.subject).toBe(copy.emails.ausenciaAprobada.subject);
    expect(email.text).toContain('15/3/2027');
    expect(email.html).toContain('15/3/2027');
    expect(email.text).toContain('Juan Pérez');
    expect(email.text).toContain(copy.emails.ausenciaAprobada.accion);
  });

  it('sin nombre: saludo genérico sin coma colgante rota', () => {
    const email = buildAusenciaApprovalEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
    });
    expect(email.text).toContain(`${copy.emails.ausenciaAprobada.saludo},`);
  });
});

describe('buildAusenciaRejectionEmail: contenido es-AR', () => {
  it('arma subject/text/html con fecha y motivo', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'empleado@test.com',
      fullName: 'Ana Gómez',
      fechaInicio: '2027-04-01',
      motivo: 'No corresponde para esta fecha.',
    });

    expect(email.subject).toBe(copy.emails.ausenciaRechazada.subject);
    expect(email.text).toContain('1/4/2027');
    expect(email.text).toContain('No corresponde para esta fecha.');
    expect(email.html).toContain('No corresponde para esta fecha.');
    expect(email.text).toContain('Ana Gómez');
  });

  it('escapa HTML en el motivo para evitar inyección en el cuerpo', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      motivo: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('escapa HTML en el nombre del saludo', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fullName: '<b>Nombre</b>',
      fechaInicio: '2027-01-01',
      motivo: 'motivo',
    });
    expect(email.html).not.toContain('<b>Nombre</b>');
    expect(email.html).toContain('&lt;b&gt;');
  });
});
