import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { MonthNav } from './MonthNav';
import { Legend } from './Legend';
import { RosterGrid } from './RosterGrid';
import { getCurrentYearMonth, getDaysInMonth } from './utils';
import type { RotationAssignment } from '@/lib/db-types';
import type { RosterEmployee } from './RosterGrid';

type CalendarioPageProps = {
  searchParams: Promise<{ year?: string; month?: string }>;
};

export default async function CalendarioPage({ searchParams }: CalendarioPageProps) {
  // Ruta compartida por los 3 roles (ver lib/roles.ts). El gating admin-only
  // de esta pieza vive acá (branch de render) y en la server action de
  // escritura (upsertRotationAssignment → requireAdmin). Supervisor/empleado
  // siguen viendo el placeholder hasta la pieza de vistas de lectura.
  const profile = await requireAuth();
  const isAdmin = profile.role === 'admin';

  if (!isAdmin) {
    return <PlaceholderPage />;
  }

  const params = await searchParams;
  const current = getCurrentYearMonth();
  const year = Number(params.year) || current.year;
  const month = Number(params.month) || current.month;

  const days = getDaysInMonth(year, month);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const supabase = await createServerClient();

  const { data: employeesRaw, error: employeesError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['empleado', 'supervisor'])
    .eq('status', 'activo')
    .order('full_name', { ascending: true });

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
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-secondary">{copy.calendario.title}</h2>
        <p className="text-sm text-neutral mt-0.5">{copy.calendario.subtitle}</p>
      </div>

      <Card padding="sm">
        <div className="space-y-4">
          <MonthNav year={year} month={month} />
          <Legend />
          <RosterGrid employees={employees} days={days} assignments={assignments} />
        </div>
      </Card>
    </div>
  );
}
