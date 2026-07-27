/**
 * lib/rotation/ausencia-display.ts (FB-F4-05) — helpers de presentación
 * compartidos por MisSolicitudesTable y AprobacionesTable: formateo de
 * fecha/rango y label de motivo (con el detalle libre de 'otros').
 */

import { describe, it, expect } from 'vitest';
import { formatFechaAusencia, formatRangoAusencia, motivoAusenciaLabel } from '@/lib/rotation/ausencia-display';
import { copy } from '@/lib/copy';

describe('formatFechaAusencia', () => {
  it('formatea una fecha YYYY-MM-DD en es-AR sin corrimiento por timezone', () => {
    expect(formatFechaAusencia('2027-03-15')).toBe('15/3/2027');
  });
});

describe('formatRangoAusencia', () => {
  it('fecha_inicio === fecha_fin: muestra una sola fecha, no un rango', () => {
    expect(formatRangoAusencia('2027-03-15', '2027-03-15')).toBe('15/3/2027');
  });

  it('fecha_inicio !== fecha_fin: muestra el rango completo', () => {
    expect(formatRangoAusencia('2027-07-01', '2027-07-05')).toBe('1/7/2027 – 5/7/2027');
  });
});

describe('motivoAusenciaLabel', () => {
  it('motivo distinto de otros: label amigable, sin sufijo', () => {
    expect(motivoAusenciaLabel('vacaciones')).toBe(copy.calendario.motivos.vacaciones);
    expect(motivoAusenciaLabel('dia_tramite')).toBe(copy.calendario.motivos.dia_tramite);
  });

  it("motivo 'otros' con texto: agrega el detalle al label", () => {
    expect(motivoAusenciaLabel('otros', 'Trámite médico')).toBe(
      `${copy.calendario.motivos.otros} — Trámite médico`
    );
  });

  it("motivo 'otros' sin texto (null/undefined): solo el label base", () => {
    expect(motivoAusenciaLabel('otros', null)).toBe(copy.calendario.motivos.otros);
    expect(motivoAusenciaLabel('otros')).toBe(copy.calendario.motivos.otros);
  });
});
