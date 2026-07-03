import { copy } from '@/lib/copy';
import type { EstadoDia, MotivoAusencia, RotationAssignment } from '@/lib/db-types';

export type YearMonth = { year: number; month: number };

export function getCurrentYearMonth(today: Date = new Date()): YearMonth {
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

export function getAdjacentMonth(year: number, month: number, delta: number): YearMonth {
  // Date.UTC toma el mes 0-indexado; pasar nuestro `month` (1-indexado) + delta
  // directamente ya apunta al mes correcto tras la suma.
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// Fechas ISO (YYYY-MM-DD) de todos los días del mes dado (1-indexado).
export function getDaysInMonth(year: number, month: number): string[] {
  const daysCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const days: string[] = [];
  for (let day = 1; day <= daysCount; day++) {
    days.push(`${year}-${mm}-${String(day).padStart(2, '0')}`);
  }
  return days;
}

export function assignmentKey(userId: string, fecha: string): string {
  return `${userId}_${fecha}`;
}

export function buildAssignmentIndex(
  assignments: RotationAssignment[]
): Map<string, RotationAssignment> {
  const index = new Map<string, RotationAssignment>();
  for (const a of assignments) {
    index.set(assignmentKey(a.user_id, a.fecha), a);
  }
  return index;
}

export type CellVisual = { bgClass: string; label: string };

const ESTADO_BG_CLASS: Record<EstadoDia, string> = {
  trabajando: 'bg-calendar-trabajando',
  en_viaje: 'bg-calendar-enViaje',
  en_franco: 'bg-calendar-enFranco',
  periodo_fuera_trabajo: 'bg-calendar-fueraTrabajo',
};

// Celda sin asignación = gris (default, no es un estado). Estimado = mismo
// color del estado real pero en tono más claro (opacidad reducida).
export function getCellVisual(assignment: RotationAssignment | undefined): CellVisual {
  if (!assignment) {
    return { bgClass: 'bg-calendar-vacio', label: copy.calendario.leyenda.sinCargar };
  }
  const base = ESTADO_BG_CLASS[assignment.estado_dia];
  const bgClass = assignment.es_estimado ? `${base}/35` : base;
  return { bgClass, label: copy.status[assignment.estado_dia] };
}

// PRD Fase 3, decisión #2: un cron nocturno (pieza posterior) pasa es_estimado
// a false cuando fecha <= hoy + 7 días. Acá solo calculamos el default al
// crear/editar una celda; el admin puede sobrescribirlo.
export function computeDefaultEsEstimado(fecha: string, today: string): boolean {
  const [fy, fm, fd] = fecha.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const fechaMs = Date.UTC(fy, fm - 1, fd);
  const todayMs = Date.UTC(ty, tm - 1, td);
  const diffDays = Math.round((fechaMs - todayMs) / (1000 * 60 * 60 * 24));
  return diffDays > 7;
}

export type ValidateAssignmentInput = {
  estado_dia: EstadoDia;
  motivo_ausencia?: MotivoAusencia | null;
  motivo_otros_texto?: string | null;
};

export type ValidationResult = { valid: true } | { valid: false; error: string };

// Refina en la UI la misma regla que el CHECK de base
// rotation_assignments_motivo_requerido (migración 0009): dar feedback antes
// de escribir, no reemplazar la garantía de la base.
export function validateAssignmentInput(input: ValidateAssignmentInput): ValidationResult {
  if (input.estado_dia !== 'periodo_fuera_trabajo') {
    return { valid: true };
  }

  if (!input.motivo_ausencia) {
    return { valid: false, error: copy.calendario.errors.motivoRequerido };
  }

  if (input.motivo_ausencia === 'otros') {
    const texto = input.motivo_otros_texto?.trim() ?? '';
    if (texto.length === 0) {
      return { valid: false, error: copy.calendario.errors.motivoOtrosRequerido };
    }
    if (texto.length > 80) {
      return { valid: false, error: copy.calendario.errors.motivoOtrosMaximo };
    }
  }

  return { valid: true };
}
