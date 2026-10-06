/**
 * FB-PI-04 — Mapeo etiqueta↔enum del Excel del calendario
 * (lib/rotation/calendario-excel-mapping.ts), compartido por export e import.
 *
 * La exhaustividad se compara contra Constants.public.Enums de
 * supabase/types.ts — el archivo regenerado del esquema real. Si una
 * migración suma un valor a estado_dia o motivo_ausencia y se regeneran los
 * tipos, este test falla hasta que el valor tenga etiqueta (además del
 * typecheck, por los Record<…> del módulo).
 */
import { describe, it, expect } from 'vitest';
import { Constants } from '@/supabase/types';
import { copy } from '@/lib/copy';
import {
  ESTADO_EXCEL_LABELS,
  MOTIVO_EXCEL_LABELS,
  ESTADOS_EXCEL,
  MOTIVOS_EXCEL,
  estadoToExcelLabel,
  motivoToExcelLabel,
  excelLabelToEstado,
  excelLabelToMotivo,
} from '@/lib/rotation/calendario-excel-mapping';
import { listFormula } from '@/lib/rotation/calendario-excel';

const ENUM_ESTADO = [...Constants.public.Enums.estado_dia];
const ENUM_MOTIVO = [...Constants.public.Enums.motivo_ausencia];

describe('mapeo Excel: exhaustividad contra el esquema', () => {
  it('estado_dia: cada valor del enum tiene etiqueta y no sobra ninguna', () => {
    expect([...ESTADOS_EXCEL].sort()).toEqual([...ENUM_ESTADO].sort());
    for (const estado of ENUM_ESTADO) {
      expect(ESTADO_EXCEL_LABELS[estado], `falta etiqueta para estado_dia='${estado}'`).toBeTruthy();
    }
  });

  it('motivo_ausencia: cada valor del enum tiene etiqueta y no sobra ninguna', () => {
    expect([...MOTIVOS_EXCEL].sort()).toEqual([...ENUM_MOTIVO].sort());
    for (const motivo of ENUM_MOTIVO) {
      expect(MOTIVO_EXCEL_LABELS[motivo], `falta etiqueta para motivo_ausencia='${motivo}'`).toBeTruthy();
    }
  });
});

describe('mapeo Excel: etiquetas', () => {
  it('estados: las del PRD §3, en ese orden', () => {
    expect(ESTADOS_EXCEL.map(estadoToExcelLabel)).toEqual([
      'Trabajando',
      'En franco',
      'En viaje',
      'Período fuera del trabajo',
    ]);
  });

  it('motivos: las del PRD §3, en ese orden, tomadas de copy.calendario.motivos', () => {
    expect(MOTIVOS_EXCEL.map(motivoToExcelLabel)).toEqual([
      'Vacaciones',
      'Licencia médica',
      'Día de trámite',
      'Matrimonio',
      'Fallecimiento',
      'Otros',
    ]);
    for (const motivo of MOTIVOS_EXCEL) {
      expect(motivoToExcelLabel(motivo)).toBe(copy.calendario.motivos[motivo]);
    }
  });

  it('las etiquetas son únicas (la inversa no es ambigua)', () => {
    const estados = ESTADOS_EXCEL.map(estadoToExcelLabel);
    const motivos = MOTIVOS_EXCEL.map(motivoToExcelLabel);
    expect(new Set(estados).size).toBe(estados.length);
    expect(new Set(motivos).size).toBe(motivos.length);
  });

  it('ninguna etiqueta tiene coma ni comillas (separadores de la lista de validación de Excel)', () => {
    for (const label of [...ESTADOS_EXCEL.map(estadoToExcelLabel), ...MOTIVOS_EXCEL.map(motivoToExcelLabel)]) {
      expect(label).not.toMatch(/[,"]/);
    }
  });

  it('la fórmula de cada desplegable entra en el tope de 255 caracteres de Excel', () => {
    expect(listFormula(ESTADOS_EXCEL.map(estadoToExcelLabel)).length).toBeLessThanOrEqual(255);
    expect(listFormula(MOTIVOS_EXCEL.map(motivoToExcelLabel)).length).toBeLessThanOrEqual(255);
  });
});

describe('mapeo Excel: ida y vuelta (lo que el import va a leer)', () => {
  it('estado: valor → etiqueta → valor', () => {
    for (const estado of ENUM_ESTADO) {
      expect(excelLabelToEstado(estadoToExcelLabel(estado))).toBe(estado);
    }
  });

  it('motivo: valor → etiqueta → valor', () => {
    for (const motivo of ENUM_MOTIVO) {
      expect(excelLabelToMotivo(motivoToExcelLabel(motivo))).toBe(motivo);
    }
  });

  it('tolera espacios alrededor de la etiqueta', () => {
    expect(excelLabelToEstado('  En franco ')).toBe('en_franco');
    expect(excelLabelToMotivo(' Otros')).toBe('otros');
  });

  it('una etiqueta desconocida o el valor crudo del enum devuelven null (error de validación en el import)', () => {
    expect(excelLabelToEstado('Franco')).toBeNull();
    expect(excelLabelToEstado('en_franco')).toBeNull();
    expect(excelLabelToEstado('')).toBeNull();
    expect(excelLabelToMotivo('vacaciones')).toBeNull();
    expect(excelLabelToMotivo('Vacaciones de invierno')).toBeNull();
  });
});
