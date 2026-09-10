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

// Fechas ISO (YYYY-MM-DD) inclusive entre dos fechas cualquiera, en orden
// ascendente sin importar cuál de las dos se pasó primero (soporta
// shift-click en cualquier dirección dentro de la fila).
export function getDateRange(fechaA: string, fechaB: string): string[] {
  const [ay, am, ad] = fechaA.split('-').map(Number);
  const [by, bm, bd] = fechaB.split('-').map(Number);
  const startMs = Math.min(Date.UTC(ay, am - 1, ad), Date.UTC(by, bm - 1, bd));
  const endMs = Math.max(Date.UTC(ay, am - 1, ad), Date.UTC(by, bm - 1, bd));

  const days: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    days.push(`${y}-${m}-${day}`);
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

// ─── SSOT de clases de fondo del calendario (FB-F3-FIX-01) ───────────────
//
// Estos tres exports son la ÚNICA fuente de verdad de los fondos de celda:
// los consumen getCellVisual() (la grilla) y Legend.tsx (la referencia
// visual), y los tests afirman la matriz contra ellos.
//
// Las clases se escriben SIEMPRE literales y completas, nunca compuestas con
// un template literal. El scanner de Tailwind (JIT) hace un match de texto
// plano sobre el código fuente: solo emite al CSS las clases que encuentra
// escritas enteras. Antes, la variante estimada se armaba en runtime
// (base + el sufijo de opacidad), así que las variantes translúcidas de
// en_franco, en_viaje y periodo_fuera_trabajo NUNCA se generaban — el
// atributo class llegaba al DOM pero no existía en el CSS y la celda quedaba
// transparente, blanca sobre el fondo de fila (bug recO3SGuYGiB2qEJ3: un
// franco estimado se veía "en blanco" en vez de rojo). Solo se salvaba la de
// trabajando, por aparecer escrita entera en Legend.tsx.
//
// Regla para el futuro: cualquier variante nueva se agrega acá, escrita
// entera. Si alguna vez hay que componer un nombre de clase, va a safelist
// explícito en tailwind.config.ts — nunca a interpolación.
//
// OJO al documentar: el scanner NO entiende de comentarios. Escribir una de
// estas clases completa dentro de un comentario de un archivo de `content`
// alcanza para que Tailwind la emita — y eso enmascararía una regresión y
// dejaría ciego al guard de tests/unit/calendario-clases-tailwind.test.ts.
// Por eso los comentarios de acá y de Legend.tsx nombran las variantes en
// prosa en vez de escribirlas literales.

// Estado real (es_estimado = false): color pleno.
export const ESTADO_BG_CLASS: Record<EstadoDia, string> = {
  trabajando: 'bg-calendar-trabajando',
  en_viaje: 'bg-calendar-enViaje',
  en_franco: 'bg-calendar-enFranco',
  periodo_fuera_trabajo: 'bg-calendar-fueraTrabajo',
};

// Estado estimado (es_estimado = true): mismo color del estado, translúcido
// al 35% — distinguible del real y del vacío, nunca invisible.
export const ESTADO_BG_CLASS_ESTIMADO: Record<EstadoDia, string> = {
  trabajando: 'bg-calendar-trabajando/35',
  en_viaje: 'bg-calendar-enViaje/35',
  en_franco: 'bg-calendar-enFranco/35',
  periodo_fuera_trabajo: 'bg-calendar-fueraTrabajo/35',
};

// Celda sin asignación: gris. No es un estado del enum — es la ausencia de
// fila en rotation_assignments.
export const CELDA_VACIA_BG_CLASS = 'bg-calendar-vacio';

// Celda sin asignación = gris (default, no es un estado). Estimado = mismo
// color del estado real pero en tono más claro (opacidad reducida).
export function getCellVisual(assignment: RotationAssignment | undefined): CellVisual {
  if (!assignment) {
    return { bgClass: CELDA_VACIA_BG_CLASS, label: copy.calendario.leyenda.sinCargar };
  }
  const mapa = assignment.es_estimado ? ESTADO_BG_CLASS_ESTIMADO : ESTADO_BG_CLASS;
  return { bgClass: mapa[assignment.estado_dia], label: copy.status[assignment.estado_dia] };
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

// FB-F3-08: 6 columnas fijas del dashboard de motivos, siempre presentes
// (con 0) aunque el mes no tenga días de ese motivo.
export const MOTIVOS_DASHBOARD: MotivoAusencia[] = [
  'vacaciones',
  'licencia_medica',
  'dia_tramite',
  'matrimonio',
  'fallecimiento',
  'otros',
];

export type MotivoDashboardRow = {
  employeeId: string;
  fullName: string | null;
  email: string;
  counts: Record<MotivoAusencia, number>;
  total: number;
};

type DashboardEmployee = { id: string; full_name: string | null; email: string };
type DashboardAssignment = Pick<RotationAssignment, 'user_id' | 'fecha' | 'estado_dia' | 'motivo_ausencia'>;

function emptyMotivoCounts(): Record<MotivoAusencia, number> {
  return Object.fromEntries(MOTIVOS_DASHBOARD.map((m) => [m, 0])) as Record<MotivoAusencia, number>;
}

// Agrega, por empleado, la cantidad de días de periodo_fuera_trabajo de cada
// motivo dentro del mes visible. `days` acota explícitamente al mes (filtro
// de app, no solo confiar en que `assignments` ya venga recortado por query):
// días fuera de `days` no cuentan, igual que días que no son
// periodo_fuera_trabajo. "otros" se agrupa en un único número (sin exponer
// motivo_otros_texto).
export function computeMotivoDashboard(
  employees: DashboardEmployee[],
  assignments: DashboardAssignment[],
  days: string[]
): MotivoDashboardRow[] {
  const daySet = new Set(days);
  const countsByEmployee = new Map<string, Record<MotivoAusencia, number>>();
  for (const emp of employees) {
    countsByEmployee.set(emp.id, emptyMotivoCounts());
  }

  for (const a of assignments) {
    if (a.estado_dia !== 'periodo_fuera_trabajo') continue;
    if (!a.motivo_ausencia) continue;
    if (!daySet.has(a.fecha)) continue;
    const counts = countsByEmployee.get(a.user_id);
    if (!counts) continue;
    counts[a.motivo_ausencia] += 1;
  }

  return employees.map((emp) => {
    const counts = countsByEmployee.get(emp.id) ?? emptyMotivoCounts();
    const total = MOTIVOS_DASHBOARD.reduce((sum, m) => sum + counts[m], 0);
    return { employeeId: emp.id, fullName: emp.full_name, email: emp.email, counts, total };
  });
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

// Traduce el mensaje crudo de Postgres/Postgrest de un upsert fallido dentro
// del pintado por rango a un motivo legible por el admin (FB-F3-23). El
// estado/motivo del rango ya se valida una vez arriba (validateAssignmentInput)
// antes de escribir ningún día, así que estas fallas por día son casos que esa
// validación no cubre: RLS/permiso, u otro error de base no anticipado.
export function describeRangeUpsertError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('rotation_assignments_motivo_requerido')) {
    return copy.calendario.errors.motivoRequerido;
  }
  if (lower.includes('permission denied') || lower.includes('row-level security') || lower.includes('policy')) {
    return copy.calendario.range.errors.permisoDenegado;
  }
  return copy.calendario.range.errors.diaFallidoGenerico;
}
