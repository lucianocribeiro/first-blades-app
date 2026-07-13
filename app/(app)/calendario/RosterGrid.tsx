'use client';

import { useState, useEffect } from 'react';
import { copy } from '@/lib/copy';
import { buildAssignmentIndex, assignmentKey, getCellVisual, getDateRange } from './utils';
import { CellEditModal } from './CellEditModal';
import { RangeEditModal } from './RangeEditModal';
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
  readOnly?: boolean;
};

type SelectedCell = {
  employee: RosterEmployee;
  fecha: string;
  assignment: RotationAssignment | undefined;
};

type SelectedRange = {
  employee: RosterEmployee;
  fechas: string[];
};

type Anchor = {
  employeeId: string;
  fecha: string;
};

export function RosterGrid({ employees, days, assignments, readOnly = false }: RosterGridProps) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const index = buildAssignmentIndex(assignments);

  // Esc cancela un ancla de rango pendiente (FB-F3-24). Solo se escucha
  // mientras hay un ancla fijada — nunca coincide con un modal abierto (ver
  // handleCellClick: fijar el ancla y abrir un modal son mutuamente
  // excluyentes por construcción).
  useEffect(() => {
    if (!anchor) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAnchor(null);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [anchor]);

  // UX tipo planilla (FB-F3-24, fix sobre FB-F3-23): en el navegador real,
  // CellEditModal usa <dialog>.showModal(), que inertiza la página — si el
  // primer click de un rango abriera ese modal, el segundo shift-click no
  // podría dispararse hasta cerrarlo. Por eso fijar el ancla de rango NUNCA
  // abre CellEditModal: es un gesto puramente de shift-click, desacoplado
  // del click simple.
  //   · Click simple → edita ese día (CellEditModal) y cancela cualquier
  //     ancla de rango pendiente.
  //   · Primer shift-click → fija el ancla (estado visual, sin modal).
  //   · Segundo shift-click en la MISMA fila → abre el modal de rango con el
  //     rango inclusivo entre ancla y destino (en cualquier orden).
  //   · Shift-click en OTRA fila → resetea el ancla a esa celda (nuevo
  //     inicio), sin abrir ningún modal — el pintado por rango es de una
  //     sola fila, nunca cruza empleados.
  function handleCellClick(
    employee: RosterEmployee,
    fecha: string,
    assignment: RotationAssignment | undefined,
    shiftKey: boolean
  ) {
    if (shiftKey) {
      if (anchor && anchor.employeeId === employee.id) {
        setAnchor(null);
        setSelectedRange({ employee, fechas: getDateRange(anchor.fecha, fecha) });
        return;
      }
      setAnchor({ employeeId: employee.id, fecha });
      return;
    }
    setAnchor(null);
    setSelectedRange(null);
    setSelected({ employee, fecha, assignment });
  }

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
                    const isAnchor = anchor?.employeeId === emp.id && anchor.fecha === fecha;
                    const label = `${nombre} — ${fecha} — ${visual.label}`;
                    return (
                      <td key={fecha} className="p-0.5 text-center">
                        {readOnly ? (
                          <div
                            title={visual.label}
                            aria-label={label}
                            className={`w-7 h-7 rounded ${visual.bgClass}`}
                          />
                        ) : (
                          <button
                            type="button"
                            title={visual.label}
                            aria-label={label}
                            aria-pressed={isAnchor}
                            onClick={(e) => handleCellClick(emp, fecha, assignment, e.shiftKey)}
                            className={`w-7 h-7 rounded ${visual.bgClass} hover:ring-2 hover:ring-primary transition-shadow ${
                              isAnchor ? 'ring-2 ring-primary ring-offset-1' : ''
                            }`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {anchor && <p className="text-xs text-neutral mt-2">{copy.calendario.range.seleccion.anclaHint}</p>}

      {selected && (
        <CellEditModal
          employee={selected.employee}
          fecha={selected.fecha}
          assignment={selected.assignment}
          onClose={() => setSelected(null)}
        />
      )}

      {selectedRange && (
        <RangeEditModal
          employee={selectedRange.employee}
          fechas={selectedRange.fechas}
          onClose={() => setSelectedRange(null)}
        />
      )}
    </>
  );
}
