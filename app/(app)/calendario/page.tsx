import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { CalendarioSections } from './CalendarioSections';
import { getCurrentYearMonth, getDaysInMonth, computeMotivoDashboard } from './utils';
import {
  computeFrancoAlerts,
  getFrancoAlertWindowStart,
  type FrancoAlertaDia,
  type FrancoAlertRow,
} from './francoAlerts';
import { COLLAPSE_COOKIE_NAME, parseCollapseState } from './collapseState';
import { getBusinessToday } from '@/lib/rotation/promote-estimated';
import {
  computeSaldoDiasTramite,
  getYearRange,
  type DiaTramiteRow,
  type SaldoDiasTramite,
} from '@/lib/rotation/saldo-dias-tramite';
import type { RotationAssignment } from '@/lib/db-types';
import type { RosterEmployee } from './RosterGrid';
import type { MotivoDashboardRow } from './utils';

type CalendarioPageProps = {
  searchParams: Promise<{ year?: string; month?: string }>;
};

function RosterView({
  year,
  month,
  days,
  employees,
  assignments,
  readOnly,
  motivoRows,
  francoAlertRows,
  saldoRows,
  initialCollapseState,
  showFilter,
}: {
  year: number;
  month: number;
  days: string[];
  employees: RosterEmployee[];
  assignments: RotationAssignment[];
  readOnly: boolean;
  motivoRows: MotivoDashboardRow[];
  francoAlertRows: FrancoAlertRow[] | null;
  saldoRows: SaldoDiasTramite[] | null;
  initialCollapseState: ReturnType<typeof parseCollapseState>;
  showFilter: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-secondary">{copy.calendario.title}</h2>
        <p className="text-sm text-neutral mt-0.5">{copy.calendario.subtitle}</p>
      </div>

      <CalendarioSections
        year={year}
        month={month}
        days={days}
        employees={employees}
        assignments={assignments}
        readOnly={readOnly}
        motivoRows={motivoRows}
        francoAlertRows={francoAlertRows}
        saldoRows={saldoRows}
        initialCollapseState={initialCollapseState}
        showFilter={showFilter}
      />
    </div>
  );
}

export default async function CalendarioPage({ searchParams }: CalendarioPageProps) {
  // Ruta compartida por los 3 roles (ver lib/roles.ts). admin gestiona
  // (edita); supervisor ve su equipo + sí mismo; empleado ve lo suyo —
  // ambos en modo lectura (RosterGrid readOnly). El gating de escritura
  // real vive en la server action (upsertRotationAssignment → requireAdmin),
  // no en este branch: acá solo se decide el scope de datos y si la grilla
  // es interactiva.
  const profile = await requireAuth();
  const isAdmin = profile.role === 'admin';

  const params = await searchParams;
  const current = getCurrentYearMonth();
  const year = Number(params.year) || current.year;
  const month = Number(params.month) || current.month;

  const days = getDaysInMonth(year, month);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const supabase = await createServerClient();

  // Scope de app superpuesto a la RLS (aprendizaje de Fase 2, ver
  // mi-equipo/page.tsx): la RLS de profiles/rotation_assignments autoriza,
  // pero la query trae exactamente el scope de cada rol, no todo lo que la
  // RLS permitiría en el límite.
  let employeesQuery = supabase.from('profiles').select('id, full_name, email').eq('status', 'activo');

  if (isAdmin) {
    employeesQuery = employeesQuery.in('role', ['empleado', 'supervisor']);
  } else if (profile.role === 'supervisor') {
    // Equipo (supervisor_id = sí mismo) + su propia fila.
    employeesQuery = employeesQuery.or(`id.eq.${profile.id},supervisor_id.eq.${profile.id}`);
  } else {
    // Empleado: solo lo suyo.
    employeesQuery = employeesQuery.eq('id', profile.id);
  }

  const { data: employeesRaw, error: employeesError } = await employeesQuery.order('full_name', {
    ascending: true,
  });

  if (employeesError) {
    console.error('[CalendarioPage] error al cargar empleados:', employeesError.message);
    return (
      <Card>
        <p className="text-error">{copy.errors.generic}</p>
      </Card>
    );
  }

  const employees = (employeesRaw ?? []) as RosterEmployee[];
  const employeeIds = employees.map((e) => e.id);

  let assignments: RotationAssignment[] = [];
  if (employeeIds.length > 0) {
    const { data: assignmentsRaw, error: assignmentsError } = await supabase
      .from('rotation_assignments')
      .select('*')
      .in('user_id', employeeIds)
      .gte('fecha', firstDay)
      .lte('fecha', lastDay);

    if (assignmentsError) {
      console.error('[CalendarioPage] error al cargar asignaciones:', assignmentsError.message);
      return (
        <Card>
          <p className="text-error">{copy.errors.generic}</p>
        </Card>
      );
    }

    assignments = (assignmentsRaw ?? []) as RotationAssignment[];
  }

  // FB-F3-09: alertas de franco — herramienta de gestión, no visible para
  // empleado. Ventana propia (~65 días hasta hoy), independiente del mes
  // que esté navegando la grilla (MonthNav no la afecta).
  let francoAlertRows: FrancoAlertRow[] | null = null;
  if (profile.role !== 'empleado' && employeeIds.length > 0) {
    const today = getBusinessToday();
    const windowStart = getFrancoAlertWindowStart(today);

    const { data: francoDiasRaw, error: francoError } = await supabase
      .from('rotation_assignments')
      .select('user_id, fecha, estado_dia, es_estimado')
      .in('user_id', employeeIds)
      .gte('fecha', windowStart)
      .lte('fecha', today);

    if (francoError) {
      console.error('[CalendarioPage] error al cargar alertas de franco:', francoError.message);
      return (
        <Card>
          <p className="text-error">{copy.errors.generic}</p>
        </Card>
      );
    }

    francoAlertRows = computeFrancoAlerts(
      employees,
      (francoDiasRaw ?? []) as FrancoAlertaDia[],
      today
    );
  }

  // FB-F3-21: saldo de días de trámite del año en curso — herramienta de
  // gestión, no visible para empleado (que ve el suyo en Solicitud de
  // Ausencia). Ventana propia (el año calendario completo), independiente
  // del mes que esté navegando la grilla.
  let saldoRows: SaldoDiasTramite[] | null = null;
  if (profile.role !== 'empleado' && employeeIds.length > 0) {
    const { start: yearStart, end: yearEnd } = getYearRange();

    const { data: diasTramiteRaw, error: saldoError } = await supabase
      .from('rotation_assignments')
      .select('user_id, fecha, es_estimado')
      .in('user_id', employeeIds)
      .eq('motivo_ausencia', 'dia_tramite')
      .gte('fecha', yearStart)
      .lte('fecha', yearEnd);

    if (saldoError) {
      console.error('[CalendarioPage] error al cargar el saldo de días de trámite:', saldoError.message);
      return (
        <Card>
          <p className="text-error">{copy.errors.generic}</p>
        </Card>
      );
    }

    saldoRows = computeSaldoDiasTramite(employees, (diasTramiteRaw ?? []) as DiaTramiteRow[]);
  }

  const motivoRows = computeMotivoDashboard(employees, assignments, days);

  // FB-F3-11: preferencia de colapsado de las secciones, leída del
  // cookie en el render inicial (sin parpadeo). Cookie ausente/malformada
  // → default (calendario expandido; el resto, colapsado).
  const cookieStore = await cookies();
  const initialCollapseState = parseCollapseState(cookieStore.get(COLLAPSE_COOKIE_NAME)?.value);

  return (
    <RosterView
      year={year}
      month={month}
      days={days}
      employees={employees}
      assignments={assignments}
      readOnly={!isAdmin}
      motivoRows={motivoRows}
      francoAlertRows={francoAlertRows}
      saldoRows={saldoRows}
      initialCollapseState={initialCollapseState}
      showFilter={profile.role !== 'empleado'}
    />
  );
}
