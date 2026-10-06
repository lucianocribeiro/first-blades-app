// FB-PI-04 — Lectura de datos para el export del calendario a Excel.
//
// Separado de la Server Action para poder ejercitarlo en integración contra
// PostgREST real (RLS + tope de filas). Solo lectura.
//
// Cliente: siempre la sesión del admin (createServerClient), nunca
// createAdminClient — la lectura pasa por RLS (constitución §6.1).
import type { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
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
  //
  // Los ADMINS quedan afuera por decisión de producto (FB-PI-04-B, PRD §3),
  // no por omisión: un admin puede tener días propios (su ausencia o pasaje
  // para sí se auto-aprueba y escribe el calendario, FB-ADJ-01), pero esos
  // días no se exportan ni se corrigen por Excel — se gestionan en la app.
  //
  // FB-PI-AUD-04: también va por fetchAllRows. Con más de 1000 perfiles en
  // alcance, una lectura directa volvería cortada sin error y el archivo
  // (y la lectura de asignaciones, que filtra por estos IDs) quedaría
  // incompleto en silencio. Orden total: nombre para leer de corrido, email
  // y finalmente id (único) como desempate estable entre páginas.
  const { data: employeesRaw, error: employeesError } = await fetchAllRows(
    () =>
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('status', 'activo')
        .in('role', ['empleado', 'supervisor'])
        .order('full_name', { ascending: true })
        .order('email', { ascending: true })
        .order('id', { ascending: true }),
    { label: '[fetchCalendarioExportData] empleados:' }
  );

  if (employeesError) return null;

  const employees = employeesRaw as ExportEmployee[];
  if (employees.length === 0) return { employees, assignments: [] };

  const ids = employees.map((e) => e.id);

  // FB-PI-05: lectura completa con el helper compartido. PostgREST corta cada
  // respuesta en max_rows (1000) SIN avisar: una sola query de 3 meses × 25
  // empleados (~2300 filas) volvería truncada y el archivo mostraría como
  // "sin asignar" días que sí tienen asignación. Orden total por
  // UNIQUE(user_id, fecha) para que las páginas no se solapen.
  const { data: assignments, error } = await fetchAllRows(
    () =>
      supabase
        .from('rotation_assignments')
        .select('user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, notas')
        .in('user_id', ids)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('user_id', { ascending: true })
        .order('fecha', { ascending: true }),
    { label: '[fetchCalendarioExportData] asignaciones:' }
  );

  if (error) return null;

  return { employees, assignments: assignments as ExportAssignment[] };
}
