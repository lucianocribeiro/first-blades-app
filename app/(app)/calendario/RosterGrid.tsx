'use client';

import { useState } from 'react';
import { copy } from '@/lib/copy';
import { buildAssignmentIndex, assignmentKey, getCellVisual } from './utils';
import { CellEditModal } from './CellEditModal';
import type { RotationAssignment } from '@/lib/db-types';

export type RosterEmployee = {
  id: string;
  full_name: string | null;
  email: string;
};

type RosterGridProps = {
  employees: RosterEmployee[];
  days: string[];
  assignments: RotationAssignment[];
};

type SelectedCell = {
  employee: RosterEmployee;
  fecha: string;
  assignment: RotationAssignment | undefined;
};

export function RosterGrid({ employees, days, assignments }: RosterGridProps) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const index = buildAssignmentIndex(assignments);

  if (employees.length === 0) {
    return (
      <p className="text-sm text-neutral py-8 text-center">{copy.calendario.noEmpleados}</p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-card border border-color-border">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="bg-surface border-b border-color-border">
              <th className="sticky left-0 bg-surface z-10 px-3 py-2 text-left font-semibold text-secondary whitespace-nowrap min-w-[180px]">
                {copy.calendario.table.empleado}
              </th>
              {days.map((fecha) => (
                <th
                  key={fecha}
                  className="px-0 py-2 text-center font-medium text-neutral w-8 min-w-8"
                >
                  {Number(fecha.slice(-2))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, idx) => {
              const rowBg = idx % 2 === 1 ? 'bg-surface/40' : 'bg-white';
              return (
                <tr key={emp.id} className={rowBg}>
                  <td
                    className={`sticky left-0 z-10 px-3 py-1.5 text-secondary whitespace-nowrap min-w-[180px] border-r border-color-border ${rowBg}`}
                  >
                    {emp.full_name || emp.email}
                  </td>
                  {days.map((fecha) => {
                    const assignment = index.get(assignmentKey(emp.id, fecha));
                    const visual = getCellVisual(assignment);
                    const nombre = emp.full_name || emp.email;
                    return (
                      <td key={fecha} className="p-0.5 text-center">
                        <button
                          type="button"
                          title={visual.label}
                          aria-label={`${nombre} — ${fecha} — ${visual.label}`}
                          onClick={() => setSelected({ employee: emp, fecha, assignment })}
                          className={`w-7 h-7 rounded ${visual.bgClass} hover:ring-2 hover:ring-primary transition-shadow`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <CellEditModal
          employee={selected.employee}
          fecha={selected.fecha}
          assignment={selected.assignment}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
