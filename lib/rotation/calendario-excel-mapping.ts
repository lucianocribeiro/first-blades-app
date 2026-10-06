// FB-PI-04 — Mapeo ÚNICO etiqueta (es-AR) ↔ valor de enum para el archivo
// Excel del calendario. Lo usa el export (FB-PI-04) para escribir las
// etiquetas y lo va a usar el import (FB-PI-05) para leerlas: no replicar
// este mapeo en ningún otro lado (PRD §3, "Etiquetas vs. valores de base").
//
// Solo lo importa código de servidor (la Server Action del export y el
// generador del workbook); ningún componente 'use client' lo consume.
//
// Exhaustividad: los Record<EstadoDia | MotivoAusencia, …> hacen fallar el
// typecheck si el enum suma un valor sin etiqueta, y
// tests/unit/calendario-excel-mapping.test.ts lo compara en runtime contra
// Constants.public.Enums de supabase/types.ts (regenerado del esquema real).
import { copy } from '@/lib/copy';
import type { EstadoDia, MotivoAusencia } from '@/lib/db-types';

// Una sola fuente por etiqueta (FB-PI-04-B): los estados salen de
// copy.status y los motivos de copy.calendario.motivos — exactamente lo que
// el admin ve en la grilla, la leyenda y el modal de edición. El archivo no
// define etiquetas propias.
//
// El orden de las claves es el orden de los desplegables (PRD §3).
export const ESTADO_EXCEL_LABELS: Record<EstadoDia, string> = {
  trabajando:            copy.status.trabajando,
  en_franco:             copy.status.en_franco,
  en_viaje:              copy.status.en_viaje,
  periodo_fuera_trabajo: copy.status.periodo_fuera_trabajo,
};

export const MOTIVO_EXCEL_LABELS: Record<MotivoAusencia, string> = {
  vacaciones:      copy.calendario.motivos.vacaciones,
  licencia_medica: copy.calendario.motivos.licencia_medica,
  dia_tramite:     copy.calendario.motivos.dia_tramite,
  matrimonio:      copy.calendario.motivos.matrimonio,
  fallecimiento:   copy.calendario.motivos.fallecimiento,
  otros:           copy.calendario.motivos.otros,
};

export const ESTADOS_EXCEL = Object.keys(ESTADO_EXCEL_LABELS) as EstadoDia[];
export const MOTIVOS_EXCEL = Object.keys(MOTIVO_EXCEL_LABELS) as MotivoAusencia[];

// Único estado que lleva motivo (CHECK rotation_assignments_motivo_requerido).
export const ESTADO_CON_MOTIVO: EstadoDia = 'periodo_fuera_trabajo';
// Único motivo que lleva detalle en motivo_otros.
export const MOTIVO_CON_DETALLE: MotivoAusencia = 'otros';

export function estadoToExcelLabel(estado: EstadoDia): string {
  return ESTADO_EXCEL_LABELS[estado];
}

export function motivoToExcelLabel(motivo: MotivoAusencia): string {
  return MOTIVO_EXCEL_LABELS[motivo];
}

// Inversas, para el import. Comparación exacta tras recortar espacios: lo
// que no matchea devuelve null y el import lo trata como error de validación.
export function excelLabelToEstado(label: string): EstadoDia | null {
  const trimmed = label.trim();
  return ESTADOS_EXCEL.find((estado) => ESTADO_EXCEL_LABELS[estado] === trimmed) ?? null;
}

export function excelLabelToMotivo(label: string): MotivoAusencia | null {
  const trimmed = label.trim();
  return MOTIVOS_EXCEL.find((motivo) => MOTIVO_EXCEL_LABELS[motivo] === trimmed) ?? null;
}
