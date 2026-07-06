/**
 * Tests unitarios — Dashboard de motivos de ausencia (FB-F3-08)
 *
 * computeMotivoDashboard es una función pura que agrega, por empleado,
 * cuántos días de cada motivo tuvo en el mes visible (`days`), a partir de
 * los mismos `employees`/`assignments` ya scopeados por rol que arma
 * page.tsx. Cubre: conteo correcto, columnas fijas con 0, agrupación de
 * "otros" sin texto libre, y recálculo al cambiar de mes.
 */

import { describe, it, expect } from 'vitest';
import { computeMotivoDashboard, MOTIVOS_DASHBOARD, getDaysInMonth } from '@/app/(app)/calendario/utils';
import type { RotationAssignment } from '@/lib/db-types';

const EMPLOYEES = [
  { id: 'emp-1', full_name: 'Empleado Uno', email: 'emp1@test.com' },
  { id: 'emp-2', full_name: null, email: 'emp2@test.com' },
];

function makeAssignment(overrides: Partial<RotationAssignment> = {}): RotationAssignment {
  return {
    id: 'a1',
    user_id: 'emp-1',
    fecha: '2026-07-10',
    estado_dia: 'periodo_fuera_trabajo',
    es_estimado: false,
    motivo_ausencia: 'vacaciones',
    motivo_otros_texto: null,
    notas: null,
    rotation_group_id: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const JULY_DAYS = getDaysInMonth(2026, 7);

describe('computeMotivoDashboard', () => {
  it('cuenta los días de cada motivo dentro del mes visible, por empleado', () => {
    const assignments = [
      makeAssignment({ id: 'a1', user_id: 'emp-1', fecha: '2026-07-01', motivo_ausencia: 'vacaciones' }),
      makeAssignment({ id: 'a2', user_id: 'emp-1', fecha: '2026-07-02', motivo_ausencia: 'vacaciones' }),
      makeAssignment({ id: 'a3', user_id: 'emp-2', fecha: '2026-07-05', motivo_ausencia: 'licencia_medica' }),
    ];

    const rows = computeMotivoDashboard(EMPLOYEES, assignments, JULY_DAYS);

    const emp1 = rows.find((r) => r.employeeId === 'emp-1')!;
    const emp2 = rows.find((r) => r.employeeId === 'emp-2')!;
    expect(emp1.counts.vacaciones).toBe(2);
    expect(emp1.total).toBe(2);
    expect(emp2.counts.licencia_medica).toBe(1);
    expect(emp2.total).toBe(1);
  });

  it('días de otros meses no cuentan', () => {
    const assignments = [
      makeAssignment({ id: 'a1', user_id: 'emp-1', fecha: '2026-07-15', motivo_ausencia: 'vacaciones' }),
      makeAssignment({ id: 'a2', user_id: 'emp-1', fecha: '2026-08-01', motivo_ausencia: 'vacaciones' }),
      makeAssignment({ id: 'a3', user_id: 'emp-1', fecha: '2026-06-30', motivo_ausencia: 'vacaciones' }),
    ];

    const rows = computeMotivoDashboard(EMPLOYEES, assignments, JULY_DAYS);

    const emp1 = rows.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.counts.vacaciones).toBe(1);
  });

  it('días que no son periodo_fuera_trabajo no cuentan, aunque tengan motivo_ausencia', () => {
    const assignments = [
      makeAssignment({
        id: 'a1',
        user_id: 'emp-1',
        fecha: '2026-07-10',
        estado_dia: 'en_franco',
        motivo_ausencia: 'vacaciones',
      }),
    ];

    const rows = computeMotivoDashboard(EMPLOYEES, assignments, JULY_DAYS);

    const emp1 = rows.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.total).toBe(0);
    expect(emp1.counts.vacaciones).toBe(0);
  });

  it('las 6 columnas de motivo están siempre presentes, en 0 cuando no hubo días de ese motivo', () => {
    const rows = computeMotivoDashboard(EMPLOYEES, [], JULY_DAYS);

    for (const row of rows) {
      expect(Object.keys(row.counts).sort()).toEqual([...MOTIVOS_DASHBOARD].sort());
      for (const motivo of MOTIVOS_DASHBOARD) {
        expect(row.counts[motivo]).toBe(0);
      }
      expect(row.total).toBe(0);
    }
  });

  it('"otros" agrupa varios días con distinto motivo_otros_texto en un único número, sin exponer el texto', () => {
    const assignments = [
      makeAssignment({ id: 'a1', user_id: 'emp-1', fecha: '2026-07-01', motivo_ausencia: 'otros', motivo_otros_texto: 'Mudanza' }),
      makeAssignment({ id: 'a2', user_id: 'emp-1', fecha: '2026-07-02', motivo_ausencia: 'otros', motivo_otros_texto: 'Trámite personal' }),
    ];

    const rows = computeMotivoDashboard(EMPLOYEES, assignments, JULY_DAYS);

    const emp1 = rows.find((r) => r.employeeId === 'emp-1')!;
    expect(emp1.counts.otros).toBe(2);
    expect(emp1).not.toHaveProperty('motivo_otros_texto');
    expect(JSON.stringify(emp1)).not.toContain('Mudanza');
    expect(JSON.stringify(emp1)).not.toContain('Trámite personal');
  });

  it('cambiar de mes recalcula: el mismo set de asignaciones da conteos distintos según `days`', () => {
    const assignments = [
      makeAssignment({ id: 'a1', user_id: 'emp-1', fecha: '2026-07-15', motivo_ausencia: 'vacaciones' }),
      makeAssignment({ id: 'a2', user_id: 'emp-1', fecha: '2026-08-15', motivo_ausencia: 'vacaciones' }),
    ];

    const julyRows = computeMotivoDashboard(EMPLOYEES, assignments, getDaysInMonth(2026, 7));
    const augustRows = computeMotivoDashboard(EMPLOYEES, assignments, getDaysInMonth(2026, 8));

    expect(julyRows.find((r) => r.employeeId === 'emp-1')!.counts.vacaciones).toBe(1);
    expect(augustRows.find((r) => r.employeeId === 'emp-1')!.counts.vacaciones).toBe(1);
  });
});
