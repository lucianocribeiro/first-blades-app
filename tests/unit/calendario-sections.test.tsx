/**
 * Tests de render (Testing Library) — CalendarioSections (FB-F3-11)
 *
 * Orquesta las 3 secciones colapsables + el filtro por empleado. Cubre:
 * default sin cookie (calendario expandido, alertas/resumen colapsados),
 * respeto de una preferencia de colapsado ya dada (simula la cookie leída
 * por page.tsx), el filtro acotando las 3 secciones a la vez, "sin
 * selección = todos", que el filtro no persiste entre montajes (nueva
 * carga de página), y que el control de filtro no se renderiza cuando
 * showFilter=false (empleado).
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CalendarioSections } from '@/app/(app)/calendario/CalendarioSections';
import { copy } from '@/lib/copy';
import type { RosterEmployee } from '@/app/(app)/calendario/RosterGrid';
import type { RotationAssignment } from '@/lib/db-types';
import type { MotivoDashboardRow } from '@/app/(app)/calendario/utils';
import type { FrancoAlertRow } from '@/app/(app)/calendario/francoAlerts';

const EMPLOYEES: RosterEmployee[] = [
  { id: 'e1', full_name: 'Empleado Uno', email: 'e1@test.com' },
  { id: 'e2', full_name: 'Empleado Dos', email: 'e2@test.com' },
];

const DAYS = ['2026-07-01', '2026-07-02'];

const ASSIGNMENTS: RotationAssignment[] = [
  {
    id: 'a1',
    user_id: 'e1',
    fecha: '2026-07-01',
    estado_dia: 'trabajando',
    es_estimado: false,
    motivo_ausencia: null,
    motivo_otros_texto: null,
    notas: null,
    rotation_group_id: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
];

const MOTIVO_ROWS: MotivoDashboardRow[] = [
  {
    employeeId: 'e1',
    fullName: 'Empleado Uno',
    email: 'e1@test.com',
    counts: { vacaciones: 1, licencia_medica: 0, dia_tramite: 0, matrimonio: 0, fallecimiento: 0, otros: 0 },
    total: 1,
  },
  {
    employeeId: 'e2',
    fullName: 'Empleado Dos',
    email: 'e2@test.com',
    counts: { vacaciones: 0, licencia_medica: 2, dia_tramite: 0, matrimonio: 0, fallecimiento: 0, otros: 0 },
    total: 2,
  },
];

const FRANCO_ROWS: FrancoAlertRow[] = [
  { employeeId: 'e1', fullName: 'Empleado Uno', email: 'e1@test.com', tipo: 'sin_franco', valor: 48, umbral: 48, nivel: 1 },
  { employeeId: 'e2', fullName: 'Empleado Dos', email: 'e2@test.com', tipo: 'franco_excedido', valor: 10, umbral: 10, nivel: 1 },
];

const ALL_EXPANDED = { alertas: true, resumen: true, calendario: true };

function baseProps() {
  return {
    year: 2026,
    month: 7,
    days: DAYS,
    employees: EMPLOYEES,
    assignments: ASSIGNMENTS,
    readOnly: true,
    motivoRows: MOTIVO_ROWS,
    francoAlertRows: FRANCO_ROWS,
    showFilter: true,
  };
}

describe('CalendarioSections — colapsado por default (sin cookie)', () => {
  it('calendario expandido; alertas y resumen colapsados', () => {
    render(<CalendarioSections {...baseProps()} />);

    // Calendario expandido: MonthNav (botón "Hoy") visible.
    expect(screen.getByText(copy.calendario.nav.hoy)).toBeInTheDocument();

    // Alertas y resumen colapsados: sus tablas no están en el documento.
    expect(screen.queryByText(copy.calendario.alertasFranco.table.tipo)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.calendario.dashboard.total)).not.toBeInTheDocument();

    // Los 3 encabezados siguen presentes (colapsada muestra solo el título).
    expect(screen.getByText(new RegExp(copy.calendario.alertasFranco.title))).toBeInTheDocument();
    expect(screen.getByText(copy.calendario.dashboard.title)).toBeInTheDocument();
  });
});

describe('CalendarioSections — respeta una preferencia de colapsado ya dada', () => {
  it('con initialCollapseState={alertas:true, calendario:false}, respeta esa preferencia por sobre el default', () => {
    render(
      <CalendarioSections
        {...baseProps()}
        initialCollapseState={{ alertas: true, resumen: false, calendario: false }}
      />
    );

    // Alertas expandida (contra el default, que la trae colapsada).
    expect(screen.getByText(copy.calendario.alertasFranco.table.tipo)).toBeInTheDocument();
    // Calendario colapsado (contra el default, que lo trae expandido).
    expect(screen.queryByText(copy.calendario.nav.hoy)).not.toBeInTheDocument();
  });
});

describe('CalendarioSections — contador de empleados en alerta en el título', () => {
  it('el título de alertas de franco incluye la cantidad de empleados en alerta', () => {
    render(<CalendarioSections {...baseProps()} initialCollapseState={ALL_EXPANDED} />);
    expect(screen.getByText(`${copy.calendario.alertasFranco.title} (2)`)).toBeInTheDocument();
  });
});

describe('CalendarioSections — filtro por empleado acota las 3 secciones', () => {
  it('sin selección: las 3 secciones muestran a los 2 empleados', () => {
    render(<CalendarioSections {...baseProps()} initialCollapseState={ALL_EXPANDED} />);

    expect(screen.getAllByText('Empleado Uno').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Empleado Dos').length).toBeGreaterThan(0);
    expect(screen.getByText(`${copy.calendario.alertasFranco.title} (2)`)).toBeInTheDocument();
  });

  it('seleccionar un empleado acota las 3 secciones a solo ese empleado', () => {
    render(<CalendarioSections {...baseProps()} initialCollapseState={ALL_EXPANDED} />);

    fireEvent.click(screen.getByRole('button', { name: copy.calendario.filtroEmpleado.todos }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Empleado Uno'));
    // Cierra el desplegable — mientras está abierto, el listbox sigue
    // mostrando TODOS los empleados como opciones seleccionables (correcto:
    // hay que poder agregar más al filtro); lo que se acota es el
    // contenido de las 3 secciones, no la lista de opciones del filtro.
    fireEvent.click(screen.getByRole('button', { name: `1 ${copy.calendario.filtroEmpleado.seleccionado}` }));

    // "Empleado Dos" ya no aparece en ninguna sección.
    expect(screen.queryByText('Empleado Dos')).not.toBeInTheDocument();
    expect(screen.getAllByText('Empleado Uno').length).toBeGreaterThan(0);

    // El contador de alertas de franco bajó a 1 (solo emp1 quedó en el filtro).
    expect(screen.getByText(`${copy.calendario.alertasFranco.title} (1)`)).toBeInTheDocument();
  });
});

describe('CalendarioSections — el filtro no persiste entre montajes', () => {
  it('un nuevo montaje siempre arranca sin filtro, aunque una instancia previa haya filtrado', () => {
    const { unmount } = render(<CalendarioSections {...baseProps()} initialCollapseState={ALL_EXPANDED} />);
    fireEvent.click(screen.getByRole('button', { name: copy.calendario.filtroEmpleado.todos }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Empleado Uno'));
    fireEvent.click(screen.getByRole('button', { name: `1 ${copy.calendario.filtroEmpleado.seleccionado}` }));
    expect(screen.queryByText('Empleado Dos')).not.toBeInTheDocument();
    unmount();

    // Simula "salir y volver": una instancia nueva, mismas props (como
    // recargaría page.tsx), sin ningún estado de filtro pasado por props
    // (el filtro nunca se persiste, a diferencia del colapsado).
    render(<CalendarioSections {...baseProps()} initialCollapseState={ALL_EXPANDED} />);
    expect(screen.getAllByText('Empleado Dos').length).toBeGreaterThan(0);
    expect(screen.getByText(`${copy.calendario.alertasFranco.title} (2)`)).toBeInTheDocument();
  });
});

describe('CalendarioSections — showFilter por rol', () => {
  it('showFilter=false: no renderiza el control de filtro (empleado)', () => {
    render(<CalendarioSections {...baseProps()} showFilter={false} />);
    expect(screen.queryByText(copy.calendario.filtroEmpleado.label)).not.toBeInTheDocument();
  });

  it('showFilter=true: renderiza el control de filtro (admin/supervisor)', () => {
    render(<CalendarioSections {...baseProps()} showFilter={true} />);
    expect(screen.getByText(copy.calendario.filtroEmpleado.label)).toBeInTheDocument();
  });

  it('el filtro solo ofrece los empleados del scope ya resuelto (prop `employees`)', () => {
    render(<CalendarioSections {...baseProps()} showFilter={true} />);
    fireEvent.click(screen.getByRole('button', { name: copy.calendario.filtroEmpleado.todos }));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('checkbox')).toHaveLength(EMPLOYEES.length);
  });
});

describe('CalendarioSections — francoAlertRows null (empleado): sección de alertas no se renderiza', () => {
  it('no renderiza el encabezado de alertas de franco cuando francoAlertRows es null', () => {
    render(<CalendarioSections {...baseProps()} francoAlertRows={null} />);
    expect(screen.queryByText(new RegExp(copy.calendario.alertasFranco.title))).not.toBeInTheDocument();
  });
});
