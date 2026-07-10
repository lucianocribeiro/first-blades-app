'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { copy } from '@/lib/copy';
import { MonthNav } from './MonthNav';
import { Legend } from './Legend';
import { RosterGrid } from './RosterGrid';
import { MotivoDashboard } from './MotivoDashboard';
import { FrancoAlertPanel } from './FrancoAlertPanel';
import { SaldoDiasTramitePanel } from './SaldoDiasTramitePanel';
import { EmployeeFilter } from './EmployeeFilter';
import { DEFAULT_COLLAPSE_STATE, setCollapseCookie, type CollapseState, type SeccionId } from './collapseState';
import type { RotationAssignment } from '@/lib/db-types';
import type { RosterEmployee } from './RosterGrid';
import type { MotivoDashboardRow } from './utils';
import type { FrancoAlertRow } from './francoAlerts';
import type { SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';

type CalendarioSectionsProps = {
  year: number;
  month: number;
  days: string[];
  employees: RosterEmployee[];
  assignments: RotationAssignment[];
  readOnly: boolean;
  motivoRows: MotivoDashboardRow[];
  francoAlertRows: FrancoAlertRow[] | null;
  saldoRows: SaldoDiasTramite[] | null;
  initialCollapseState?: CollapseState;
  showFilter: boolean;
};

// FB-F3-11: orquesta las 3 secciones colapsables de /calendario y el
// filtro por empleado. El filtro es puramente de presentación: acota
// (nunca amplía) los `employees`/`assignments`/`motivoRows`/`francoAlertRows`
// que ya llegaron scopeados por rol desde page.tsx — no dispara ninguna
// query nueva. Vive en useState (no persiste); el colapsado sí persiste,
// vía cookie (ver collapseState.ts).
export function CalendarioSections({
  year,
  month,
  days,
  employees,
  assignments,
  readOnly,
  motivoRows,
  francoAlertRows,
  saldoRows,
  initialCollapseState = DEFAULT_COLLAPSE_STATE,
  showFilter,
}: CalendarioSectionsProps) {
  const [collapseState, setCollapseState] = useState<CollapseState>(initialCollapseState);
  // Selección vacía = sin filtro (todos los empleados del scope de rol).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggleSection(section: SeccionId) {
    setCollapseState((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      setCollapseCookie(next);
      return next;
    });
  }

  const selectedSet = selectedIds.length > 0 ? new Set(selectedIds) : null;
  const filteredEmployees = selectedSet ? employees.filter((emp) => selectedSet.has(emp.id)) : employees;
  const filteredAssignments = selectedSet
    ? assignments.filter((a) => selectedSet.has(a.user_id))
    : assignments;
  const filteredMotivoRows = selectedSet
    ? motivoRows.filter((row) => selectedSet.has(row.employeeId))
    : motivoRows;
  const filteredFrancoRows =
    francoAlertRows === null
      ? null
      : selectedSet
        ? francoAlertRows.filter((row) => selectedSet.has(row.employeeId))
        : francoAlertRows;

  const francoEmployeeCount = filteredFrancoRows
    ? new Set(filteredFrancoRows.map((row) => row.employeeId)).size
    : 0;

  const filteredSaldoRows =
    saldoRows === null
      ? null
      : selectedSet
        ? saldoRows.filter((row) => selectedSet.has(row.employeeId))
        : saldoRows;

  return (
    <div className="space-y-4">
      {showFilter && (
        <EmployeeFilter employees={employees} selectedIds={selectedIds} onChange={setSelectedIds} />
      )}

      {filteredFrancoRows !== null && (
        <CollapsibleSection
          title={`${copy.calendario.alertasFranco.title} (${francoEmployeeCount})`}
          subtitle={copy.calendario.alertasFranco.subtitle}
          icon={<AlertTriangle size={18} className="text-warning shrink-0" />}
          expanded={collapseState.alertas}
          onToggle={() => toggleSection('alertas')}
        >
          <FrancoAlertPanel rows={filteredFrancoRows} />
        </CollapsibleSection>
      )}

      {filteredSaldoRows !== null && (
        <CollapsibleSection
          title={copy.calendario.saldoDiasTramite.title}
          subtitle={copy.calendario.saldoDiasTramite.subtitle}
          expanded={collapseState.saldo}
          onToggle={() => toggleSection('saldo')}
        >
          <SaldoDiasTramitePanel rows={filteredSaldoRows} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={copy.calendario.dashboard.title}
        subtitle={copy.calendario.dashboard.subtitle}
        expanded={collapseState.resumen}
        onToggle={() => toggleSection('resumen')}
      >
        <MotivoDashboard rows={filteredMotivoRows} />
      </CollapsibleSection>

      <CollapsibleSection
        title={copy.calendario.title}
        expanded={collapseState.calendario}
        onToggle={() => toggleSection('calendario')}
      >
        <div className="space-y-4">
          <MonthNav year={year} month={month} />
          <Legend />
          <RosterGrid
            employees={filteredEmployees}
            days={days}
            assignments={filteredAssignments}
            readOnly={readOnly}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
}
