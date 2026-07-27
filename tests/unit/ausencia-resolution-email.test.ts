/**
 * FB-F3-19 — Emails de resolución de solicitud de ausencia, generalizados a
 * cualquier motivo en FB-F4-06 (antes hardcodeados a "día de trámite").
 *
 * Cubre, con el transporte de Gmail SIEMPRE mockeado (ningún test toca la red):
 *  - Builders de aprobación/rechazo (motivo amigable, rango, nombre, copy es-AR).
 *  - Rango de un solo día (fecha_inicio === fecha_fin, ej. día de trámite).
 *  - Motivo 'otros' incluye el texto libre.
 *  - Escaping de HTML en valores dinámicos.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAusenciaApprovalEmail,
  buildAusenciaRejectionEmail,
} from '@/lib/email/ausencia-resolution-email';
import { copy } from '@/lib/copy';

describe('buildAusenciaApprovalEmail: contenido es-AR', () => {
  it('arma subject/text/html con motivo amigable y el rango de varios días', () => {
    const email = buildAusenciaApprovalEmail({
      to: 'empleado@test.com',
      fullName: 'Juan Pérez',
      fechaInicio: '2027-03-15',
      fechaFin: '2027-03-20',
      motivoAusencia: 'vacaciones',
    });

    expect(email.to).toBe('empleado@test.com');
    expect(email.subject).toBe(copy.emails.ausenciaAprobada.subject);
    expect(email.subject).toContain('solicitud de ausencia');
    expect(email.text).toContain(copy.calendario.motivos.vacaciones);
    expect(email.text).toContain('15/3/2027 – 20/3/2027');
    expect(email.html).toContain('15/3/2027 – 20/3/2027');
    expect(email.text).toContain('Juan Pérez');
    expect(email.text).toContain(copy.emails.ausenciaAprobada.accion);
  });

  it('rango de un solo día (ej. día de trámite): fecha_inicio === fecha_fin se muestra como fecha única', () => {
    const email = buildAusenciaApprovalEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'dia_tramite',
    });

    expect(email.text).toContain(copy.calendario.motivos.dia_tramite);
    expect(email.text).toContain('1/1/2027');
    expect(email.text).not.toContain('–');
  });

  it('motivo "otros": incluye el texto libre junto a la etiqueta base', () => {
    const email = buildAusenciaApprovalEmail({
      to: 'x@test.com',
      fechaInicio: '2027-02-01',
      fechaFin: '2027-02-01',
      motivoAusencia: 'otros',
      motivoOtrosTexto: 'Mudanza',
    });

    expect(email.text).toContain(`${copy.calendario.motivos.otros} — Mudanza`);
  });

  it('sin nombre: saludo genérico sin coma colgante rota', () => {
    const email = buildAusenciaApprovalEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'dia_tramite',
    });
    expect(email.text).toContain(`${copy.emails.ausenciaAprobada.saludo},`);
  });
});

describe('buildAusenciaRejectionEmail: contenido es-AR', () => {
  it('arma subject/text/html con motivo amigable, rango y motivo del rechazo', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'empleado@test.com',
      fullName: 'Ana Gómez',
      fechaInicio: '2027-04-01',
      fechaFin: '2027-04-03',
      motivoAusencia: 'licencia_medica',
      motivoRechazo: 'No corresponde para esta fecha.',
    });

    expect(email.subject).toBe(copy.emails.ausenciaRechazada.subject);
    expect(email.subject).toContain('solicitud de ausencia');
    expect(email.text).toContain(copy.calendario.motivos.licencia_medica);
    expect(email.text).toContain('1/4/2027 – 3/4/2027');
    expect(email.text).toContain('No corresponde para esta fecha.');
    expect(email.html).toContain('No corresponde para esta fecha.');
    expect(email.text).toContain('Ana Gómez');
  });

  it('día de trámite (rango de un día) sigue produciendo un mail correcto', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'dia_tramite',
      motivoRechazo: 'motivo',
    });

    expect(email.text).toContain(copy.calendario.motivos.dia_tramite);
    expect(email.text).toContain('1/1/2027');
    expect(email.text).not.toContain('–');
  });

  it('motivo "otros": incluye el texto libre', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'otros',
      motivoOtrosTexto: 'Trámite personal',
      motivoRechazo: 'motivo',
    });

    expect(email.text).toContain(`${copy.calendario.motivos.otros} — Trámite personal`);
  });

  it('escapa HTML en el motivo del rechazo para evitar inyección en el cuerpo', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'dia_tramite',
      motivoRechazo: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('escapa HTML en el texto libre de motivo "otros"', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'otros',
      motivoOtrosTexto: '<script>alert(1)</script>',
      motivoRechazo: 'motivo',
    });
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('escapa HTML en el nombre del saludo', () => {
    const email = buildAusenciaRejectionEmail({
      to: 'x@test.com',
      fullName: '<b>Nombre</b>',
      fechaInicio: '2027-01-01',
      fechaFin: '2027-01-01',
      motivoAusencia: 'dia_tramite',
      motivoRechazo: 'motivo',
    });
    expect(email.html).not.toContain('<b>Nombre</b>');
    expect(email.html).toContain('&lt;b&gt;');
  });
});
