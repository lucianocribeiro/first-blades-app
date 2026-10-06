// FB-PI-04 — Lectura de datos para el export del calendario a Excel.
//
// Separado de la Server Action para poder ejercitarlo en integración contra
// PostgREST real (RLS + tope de filas). Solo lectura.
//
// Cliente: siempre la sesión del admin (createServerClient), nunca
// createAdminClient — la lectura pasa por RLS (constitución §6.1).
import type { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import type { RotationAssignment } from '@/lib/db-types';

// Mismo criterio que lib/aprobaciones.ts: el tipo del cliente de
// @supabase/ssr no es asignable a SupabaseClient<Database> a secas.
type Supabase = Awaited<ReturnType<typeof createServerClient>>;

export type ExportEmployee = { id: string; full_name: string; email: string };

export type ExportAssignment = Pick<
  RotationAssignment,
  'user_id' | 'fecha' | 'estado_dia' | 'motivo_ausencia' | 'motivo_otros_texto' | 'notas'
>;

export type CalendarioExportData = {
  employees: ExportEmployee[];
  assignments: ExportAssignment[];
};

// Tope de un rango exportable: un año (bisiesto incluido). Acota el tamaño
// del archivo (≈ empleados × días filas) y del payload de la action.
export const MAX_DIAS_EXPORT = 366;

// Tamaño de página para leer rotation_assignments. PostgREST corta cada
// respuesta en `max_rows` (1000 en supabase/config.toml y en Supabase
// hosted) SIN avisar: una sola query de 3 meses × 27 empleados (~2500
// filas) volvería truncada y el archivo mostraría como "sin asignar" días
// que sí tienen asignación. Por eso se pagina hasta agotar.
export const PAGE_SIZE = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function diasEntre(desde: string, hasta: string): number {
  const [ay, am, ad] = desde.split('-').map(Number);
  const [by, bm, bd] = hasta.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
}

// Devuelve el mensaje de error (copy es-AR) o null si el rango es válido.
export function validarRangoExport(desde: string, hasta: string): string | null {
  if (!isValidIsoDate(desde) || !isValidIsoDate(hasta)) return copy.calendario.excel.errors.fechaInvalida;
  if (desde > hasta) return copy.calendario.excel.errors.rangoInvertido;
  if (diasEntre(desde, hasta) > MAX_DIAS_EXPORT) return copy.calendario.excel.errors.rangoExcedido;
  return null;
}

// null = alguna lectura falló (ya logueada). Los errores de PostgREST llegan
// como valor (constitución §2.5), no como excepción: se leen uno por uno.
export async function fetchCalendarioExportData(
  supabase: Supabase,
  desde: string,
  hasta: string
): Promise<CalendarioExportData | null> {
  // Mismo scope que el roster del admin en calendario/page.tsx: empleados y
  // supervisores ACTIVOS. Los inactivos no salen en el archivo.
  const { data: employeesRaw, error: employeesError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'activo')
    .in('role', ['empleado', 'supervisor'])
    .order('full_name', { ascending: true })
    .order('email', { ascending: true });

  if (employeesError) {
    console.error('[fetchCalendarioExportData] error al cargar empleados:', employeesError.message);
    return null;
  }

  const employees = (employeesRaw ?? []) as ExportEmployee[];
  if (employees.length === 0) return { employees, assignments: [] };

  const ids = employees.map((e) => e.id);
  const assignments: ExportAssignment[] = [];

  // Se avanza por lo que efectivamente llegó y se corta recién con una página
  // vacía: si el servidor tuviera un max_rows menor a PAGE_SIZE, cortar por
  // "page.length < PAGE_SIZE" volvería a truncar en silencio.
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from('rotation_assignments')
      .select('user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, notas')
      .in('user_id', ids)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      // Orden total y estable (UNIQUE(user_id, fecha)): sin esto las páginas
      // podrían solaparse o saltearse filas entre requests.
      .order('user_id', { ascending: true })
      .order('fecha', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('[fetchCalendarioExportData] error al cargar asignaciones:', error.message);
      return null;
    }

    const page = (data ?? []) as ExportAssignment[];
    if (page.length === 0) break;
    assignments.push(...page);
    from += page.length;
  }

  return { employees, assignments };
}
