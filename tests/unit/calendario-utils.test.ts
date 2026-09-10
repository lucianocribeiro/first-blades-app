/**
 * Tests unitarios — Grilla del roster del Calendario (FB-F3-04)
 *
 * Cubre: cálculo de días del mes, navegación de mes, índice de asignaciones,
 * visual de celda (gris por default, tono claro para estimados), y el
 * default de es_estimado (PRD Fase 3, decisión #2: estimado si fecha > hoy + 7 días).
 */

import { describe, it, expect } from 'vitest';
import { canAccess } from '@/lib/roles';
import { copy } from '@/lib/copy';
import {
  getCurrentYearMonth,
  getAdjacentMonth,
  getDaysInMonth,
  assignmentKey,
  buildAssignmentIndex,
  getCellVisual,
  computeDefaultEsEstimado,
  getDateRange,
  describeRangeUpsertError,
  ESTADO_BG_CLASS,
  ESTADO_BG_CLASS_ESTIMADO,
  CELDA_VACIA_BG_CLASS,
} from '@/app/(app)/calendario/utils';
import type { EstadoDia, RotationAssignment } from '@/lib/db-types';

// Los 4 valores del enum estado_dia. Declarados acá (no derivados de un mapa)
// para que agregar un estado al enum sin agregarlo a AMBOS mapas del SSOT
// rompa la matriz de abajo en vez de pasar inadvertido.
const ESTADOS: EstadoDia[] = ['trabajando', 'en_viaje', 'en_franco', 'periodo_fuera_trabajo'];

// ─── Gating de rol (ruta compartida, no admin-only) ────────────

describe('gating de rol: calendario', () => {
  it('admin, supervisor y empleado pueden acceder a la ruta /calendario', () => {
    expect(canAccess('admin', 'calendario')).toBe(true);
    expect(canAccess('supervisor', 'calendario')).toBe(true);
    expect(canAccess('empleado', 'calendario')).toBe(true);
  });
});

// ─── getCurrentYearMonth ────────────────────────────────────────

describe('getCurrentYearMonth', () => {
  it('devuelve año y mes 1-indexado de la fecha dada', () => {
    expect(getCurrentYearMonth(new Date(Date.UTC(2026, 6, 3)))).toEqual({ year: 2026, month: 7 });
  });
});

// ─── getAdjacentMonth ───────────────────────────────────────────

describe('getAdjacentMonth', () => {
  it('mes siguiente dentro del mismo año', () => {
    expect(getAdjacentMonth(2026, 7, 1)).toEqual({ year: 2026, month: 8 });
  });

  it('mes anterior dentro del mismo año', () => {
    expect(getAdjacentMonth(2026, 7, -1)).toEqual({ year: 2026, month: 6 });
  });

  it('cruza a diciembre del año anterior', () => {
    expect(getAdjacentMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('cruza a enero del año siguiente', () => {
    expect(getAdjacentMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
});

// ─── getDaysInMonth ─────────────────────────────────────────────

describe('getDaysInMonth', () => {
  it('julio 2026 tiene 31 días, primero y último correctos', () => {
    const days = getDaysInMonth(2026, 7);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-07-01');
    expect(days[30]).toBe('2026-07-31');
  });

  it('febrero 2026 (no bisiesto) tiene 28 días', () => {
    expect(getDaysInMonth(2026, 2)).toHaveLength(28);
  });

  it('febrero 2028 (bisiesto) tiene 29 días', () => {
    expect(getDaysInMonth(2028, 2)).toHaveLength(29);
  });
});

// ─── buildAssignmentIndex / assignmentKey ──────────────────────

function makeAssignment(overrides: Partial<RotationAssignment> = {}): RotationAssignment {
  return {
    id: 'a1',
    user_id: 'user-1',
    fecha: '2026-07-10',
    estado_dia: 'trabajando',
    es_estimado: false,
    motivo_ausencia: null,
    motivo_otros_texto: null,
    notas: null,
    rotation_group_id: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildAssignmentIndex', () => {
  it('indexa por user_id + fecha y permite lookup con assignmentKey', () => {
    const a = makeAssignment();
    const index = buildAssignmentIndex([a]);
    expect(index.get(assignmentKey('user-1', '2026-07-10'))).toBe(a);
  });

  it('no encuentra una combinación user_id/fecha que no existe', () => {
    const index = buildAssignmentIndex([makeAssignment()]);
    expect(index.get(assignmentKey('user-1', '2026-07-11'))).toBeUndefined();
  });
});

// ─── getCellVisual ──────────────────────────────────────────────

describe('getCellVisual', () => {
  it('celda sin asignación es gris (default, no es un estado)', () => {
    const visual = getCellVisual(undefined);
    expect(visual.bgClass).toBe(CELDA_VACIA_BG_CLASS);
    expect(visual.bgClass).toBe('bg-calendar-vacio');
    expect(visual.label).toBe(copy.calendario.leyenda.sinCargar);
  });

  // ─── Matriz completa: 4 estados × es_estimado true/false ──────
  //
  // FB-F3-FIX-01: antes se cubrían solo `en_franco` estimado y los 4 estados
  // reales; la variante estimada de en_viaje y periodo_fuera_trabajo no
  // tenía ningún test. La matriz cierra el hueco y afirma contra el SSOT
  // (ESTADO_BG_CLASS / ESTADO_BG_CLASS_ESTIMADO), que es el único lugar
  // donde se declaran las clases.
  describe.each(ESTADOS)('estado %s', (estado) => {
    it('real (es_estimado=false) usa la clase sólida del SSOT', () => {
      const visual = getCellVisual(makeAssignment({ estado_dia: estado, es_estimado: false }));
      expect(visual.bgClass).toBe(ESTADO_BG_CLASS[estado]);
      expect(visual.label).toBe(copy.status[estado]);
    });

    it('estimado (es_estimado=true) usa la clase translúcida del SSOT', () => {
      const visual = getCellVisual(makeAssignment({ estado_dia: estado, es_estimado: true }));
      expect(visual.bgClass).toBe(ESTADO_BG_CLASS_ESTIMADO[estado]);
      expect(visual.label).toBe(copy.status[estado]);
    });

    it('estimado y real son clases distintas, y ninguna es la de celda vacía', () => {
      // Un estimado nunca puede terminar renderizando como "sin cargar"
      // (gris) ni confundirse con el estado real.
      expect(ESTADO_BG_CLASS_ESTIMADO[estado]).not.toBe(ESTADO_BG_CLASS[estado]);
      expect(ESTADO_BG_CLASS_ESTIMADO[estado]).not.toBe(CELDA_VACIA_BG_CLASS);
      expect(ESTADO_BG_CLASS[estado]).not.toBe(CELDA_VACIA_BG_CLASS);
    });
  });

  it('los valores esperados del SSOT son los tokens de marca del calendario', () => {
    // Anclaje explícito de los literales: si alguien renombra un token, este
    // test lo hace visible en vez de dejar que la matriz de arriba (que lee
    // del mismo mapa) siga pasando en verde contra un valor nuevo.
    expect(ESTADO_BG_CLASS).toEqual({
      trabajando: 'bg-calendar-trabajando',
      en_viaje: 'bg-calendar-enViaje',
      en_franco: 'bg-calendar-enFranco',
      periodo_fuera_trabajo: 'bg-calendar-fueraTrabajo',
    });
    expect(ESTADO_BG_CLASS_ESTIMADO).toEqual({
      trabajando: 'bg-calendar-trabajando/35',
      en_viaje: 'bg-calendar-enViaje/35',
      en_franco: 'bg-calendar-enFranco/35',
      periodo_fuera_trabajo: 'bg-calendar-fueraTrabajo/35',
    });
  });
});

// ─── computeDefaultEsEstimado ───────────────────────────────────

describe('computeDefaultEsEstimado', () => {
  it('fecha a más de 7 días de hoy es estimado', () => {
    expect(computeDefaultEsEstimado('2026-07-20', '2026-07-01')).toBe(true);
  });

  it('fecha a exactamente 7 días de hoy NO es estimado (pasa a real)', () => {
    expect(computeDefaultEsEstimado('2026-07-08', '2026-07-01')).toBe(false);
  });

  it('fecha pasada o de hoy NO es estimado', () => {
    expect(computeDefaultEsEstimado('2026-07-01', '2026-07-01')).toBe(false);
    expect(computeDefaultEsEstimado('2026-06-20', '2026-07-01')).toBe(false);
  });
});

// ─── getDateRange (FB-F3-23: pintado por rango) ────────────────

describe('getDateRange', () => {
  it('rango ascendente entre dos fechas (inclusive)', () => {
    expect(getDateRange('2026-07-01', '2026-07-03')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
  });

  it('funciona en cualquier orden de los dos extremos (shift-click hacia atrás)', () => {
    expect(getDateRange('2026-07-03', '2026-07-01')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
  });

  it('mismo día en ambos extremos devuelve un solo día', () => {
    expect(getDateRange('2026-07-05', '2026-07-05')).toEqual(['2026-07-05']);
  });

  it('cruza el límite de mes correctamente', () => {
    expect(getDateRange('2026-07-30', '2026-08-02')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});

// ─── describeRangeUpsertError (FB-F3-23: reporte por día legible) ─

describe('describeRangeUpsertError', () => {
  it('violación del CHECK de motivo requerido se traduce al copy de motivo requerido', () => {
    expect(
      describeRangeUpsertError(
        'new row for relation "rotation_assignments" violates check constraint "rotation_assignments_motivo_requerido"'
      )
    ).toBe(copy.calendario.errors.motivoRequerido);
  });

  it('error de permiso/RLS se traduce al copy de permiso denegado', () => {
    expect(describeRangeUpsertError('permission denied for table rotation_assignments')).toBe(
      copy.calendario.range.errors.permisoDenegado
    );
    expect(describeRangeUpsertError('new row violates row-level security policy')).toBe(
      copy.calendario.range.errors.permisoDenegado
    );
  });

  it('cualquier otro error de base cae al copy genérico legible', () => {
    expect(describeRangeUpsertError('db error interno')).toBe(
      copy.calendario.range.errors.diaFallidoGenerico
    );
  });
});
