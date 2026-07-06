'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { copy } from '@/lib/copy';
import type { RosterEmployee } from './RosterGrid';

type EmployeeFilterProps = {
  employees: RosterEmployee[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

// FB-F3-11: multiselect de empleados. `employees` es EXACTAMENTE el scope
// de rol ya resuelto por page.tsx (admin todos, supervisor equipo + sí
// mismo) — este control nunca amplía ese conjunto, solo acota la
// presentación dentro de él. Selección vacía = todos (sin filtro). No
// persiste: vive en useState del padre (CalendarioSections), se resetea
// en cada carga de la página.
export function EmployeeFilter({ employees, selectedIds, onChange }: EmployeeFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = copy.calendario.filtroEmpleado;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleEmployee(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const summary =
    selectedIds.length === 0
      ? t.todos
      : `${selectedIds.length} ${selectedIds.length === 1 ? t.seleccionado : t.seleccionados}`;

  return (
    <div ref={containerRef} className="relative inline-block">
      <span id="calendario-filtro-empleado-label" className="block text-sm font-medium text-secondary mb-1">
        {t.label}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby="calendario-filtro-empleado-label"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full sm:w-72 flex items-center justify-between gap-2 border border-color-border rounded-lg px-3 py-2 text-sm bg-white hover:border-neutral/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
      >
        <span className="text-secondary truncate">{summary}</span>
        <ChevronDown size={16} className="text-neutral shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby="calendario-filtro-empleado-label"
          className="absolute z-20 mt-1 w-full sm:w-72 max-h-64 overflow-y-auto bg-white border border-color-border rounded-lg shadow-card py-1"
        >
          {employees.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral">{copy.calendario.noEmpleados}</p>
          ) : (
            employees.map((emp) => {
              const checked = selectedIds.includes(emp.id);
              return (
                <label
                  key={emp.id}
                  role="option"
                  aria-selected={checked}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-secondary hover:bg-surface cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEmployee(emp.id)}
                    className="rounded border-color-border text-primary focus:ring-primary"
                  />
                  {emp.full_name || emp.email}
                </label>
              );
            })
          )}
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-blue-50 border-t border-color-border"
            >
              {t.limpiar}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
