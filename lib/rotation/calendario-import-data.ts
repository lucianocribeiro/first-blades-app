// FB-PI-11 — Lecturas para la previsualización del import del calendario.
//
// Separado de la Server Action para poder ejercitarlo en integración contra
// PostgREST real (RLS + tope de filas). Solo lectura.
//
// Cliente: siempre la sesión del admin (createServerClient), nunca
// createAdminClient — la lectura pasa por RLS (constitución §6.1).
//
// Todas las lecturas van por fetchAllRows: el calendario, las solicitudes y
// la nómina crecen con el tiempo, y PostgREST corta en max_rows (1000) sin
// avisar (FB-PI-05).
import type { createServerClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type {
  ApprovedAusencia,
  ApprovedPasaje,
  CurrentAssignment,
  DiaTramiteActual,
  ImportProfile,
} from './calendario-import';

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

// TODOS los perfiles (también admins e inactivos): la validación necesita
// distinguir "no existe" de "es admin" o "está inactivo" para dar un error
// preciso. Orden total por id para que las páginas no se solapen.
export async function fetchImportProfiles(supabase: Supabase): Promise<ImportProfile[] | null> {
  const { data, error } = await fetchAllRows(
    () => supabase.from('profiles').select('id, email, full_name, role, status').order('id', { ascending: true }),
    { label: '[fetchImportProfiles] perfiles:' }
  );
  if (error) return null;
  return data as ImportProfile[];
}

export type ImportContext = {
  actuales: CurrentAssignment[];
  ausencias: ApprovedAusencia[];
  pasajes: ApprovedPasaje[];
  diasTramite: DiaTramiteActual[];
};

// null = alguna lectura falló (ya logueada por fetchAllRows).
export async function fetchImportContext(
  supabase: Supabase,
  userIds: string[],
  desde: string,
  hasta: string
): Promise<ImportContext | null> {
  if (userIds.length === 0) return { actuales: [], ausencias: [], pasajes: [], diasTramite: [] };

  // Estado actual de cada día del rango para los empleados del archivo.
  const actuales = await fetchAllRows(
    () =>
      supabase
        .from('rotation_assignments')
        .select('id, user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, notas, es_estimado')
        .in('user_id', userIds)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('user_id', { ascending: true })
        .order('fecha', { ascending: true }),
    { label: '[fetchImportContext] calendario:' }
  );
  if (actuales.error) return null;

  // Ausencias aprobadas que se superponen con el rango. La exclusión de las
  // canceladas la hace calcularPlanImport (misma condición que 0017/0022).
  const ausencias = await fetchAllRows(
    () =>
      supabase
        .from('ausencia_requests')
        .select('id, user_id, fecha_inicio, fecha_fin, post_aprobacion_tipo')
        .in('user_id', userIds)
        .eq('estado', 'aprobado')
        .lte('fecha_inicio', hasta)
        .gte('fecha_fin', desde)
        .order('id', { ascending: true }),
    { label: '[fetchImportContext] ausencias aprobadas:' }
  );
  if (ausencias.error) return null;

  // Pasajes aprobados de esos empleados: dias_viaje son fechas discretas, el
  // cruce con el rango lo hace calcularPlanImport.
  const pasajes = await fetchAllRows(
    () =>
      supabase
        .from('pasaje_requests')
        .select('id, empleado_id, dias_viaje, post_aprobacion_tipo')
        .in('empleado_id', userIds)
        .eq('estado', 'aprobado')
        .order('id', { ascending: true }),
    { label: '[fetchImportContext] pasajes aprobados:' }
  );
  if (pasajes.error) return null;

  // Días de trámite de los AÑOS completos que toca el archivo: el saldo es
  // por año calendario, no por el rango importado.
  const diasTramite = await fetchAllRows(
    () =>
      supabase
        .from('rotation_assignments')
        .select('user_id, fecha')
        .in('user_id', userIds)
        .eq('motivo_ausencia', 'dia_tramite')
        .gte('fecha', `${desde.slice(0, 4)}-01-01`)
        .lte('fecha', `${hasta.slice(0, 4)}-12-31`)
        .order('user_id', { ascending: true })
        .order('fecha', { ascending: true }),
    { label: '[fetchImportContext] días de trámite:' }
  );
  if (diasTramite.error) return null;

  return {
    actuales: actuales.data as CurrentAssignment[],
    ausencias: ausencias.data as ApprovedAusencia[],
    pasajes: pasajes.data as ApprovedPasaje[],
    diasTramite: diasTramite.data as DiaTramiteActual[],
  };
}
