import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { MonthNav } from './MonthNav';
import { Legend } from './Legend';
import { RosterGrid } from './RosterGrid';
import { getCurrentYearMonth, getDaysInMonth } from './utils';
import type { RotationAssignment } from '@/lib/db-types';
import type { RosterEmployee } from './RosterGrid';

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
}: {
  year: number;
  month: number;
  days: string[];
  employees: RosterEmployee[];
  assignments: RotationAssignment[];
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-secondary">{copy.calendario.title}</h2>
        <p className="text-sm text-neutral mt-0.5">{copy.calendario.subtitle}</p>
      </div>

      <Card padding="sm">
        <div className="space-y-4">
          <MonthNav year={year} month={month} />
          <Legend />
          <RosterGrid employees={employees} days={days} assignments={assignments} readOnly={readOnly} />
        </div>
      </Card>
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

  return (
    <RosterView
      year={year}
      month={month}
      days={days}
      employees={employees}
      assignments={assignments}
      readOnly={!isAdmin}
    />
  );
}
