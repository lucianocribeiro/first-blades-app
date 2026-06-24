/**
 * Tests unitarios — Módulo Equipo (FB-F2-01)
 *
 * Cubre: gating de rol, lógica de contadores documentales,
 * panel "Próximos a vencer", resolución de supervisor, formateo.
 */

import { describe, it, expect } from 'vitest';
import { canAccess } from '@/lib/roles';
import { copy } from '@/lib/copy';
import {
  getDiasRestantes,
  getUrgencyBgClass,
  formatDocTypeLabel,
  buildSupervisorMap,
  computeDocCounts,
  buildProximosAVencer,
  buildProfilesWithCounts,
  formatDate,
  formatDiasRestantes,
} from '@/app/(app)/equipo/utils';
import type { ProfileRow, DocRow } from '@/app/(app)/equipo/utils';

// ─── Gating de rol ────────────────────────────────────────────

describe('gating de rol: equipo', () => {
  it('admin puede acceder a equipo', () => {
    expect(canAccess('admin', 'equipo')).toBe(true);
  });

  it('supervisor NO puede acceder a equipo (caso negativo)', () => {
    expect(canAccess('supervisor', 'equipo')).toBe(false);
  });

  it('empleado NO puede acceder a equipo (caso negativo)', () => {
    expect(canAccess('empleado', 'equipo')).toBe(false);
  });
});

// ─── getDiasRestantes ─────────────────────────────────────────

describe('getDiasRestantes', () => {
  it('misma fecha devuelve 0', () => {
    expect(getDiasRestantes('2026-07-15', '2026-07-15')).toBe(0);
  });

  it('vence en 5 días devuelve 5', () => {
    expect(getDiasRestantes('2026-07-20', '2026-07-15')).toBe(5);
  });

  it('vence en 30 días devuelve 30', () => {
    expect(getDiasRestantes('2026-08-14', '2026-07-15')).toBe(30);
  });

  it('vencido hace 1 día devuelve -1', () => {
    expect(getDiasRestantes('2026-07-14', '2026-07-15')).toBe(-1);
  });

  it('vencido hace 10 días devuelve -10', () => {
    expect(getDiasRestantes('2026-07-05', '2026-07-15')).toBe(-10);
  });

  it('vence en 31 días devuelve 31 (fuera de ventana)', () => {
    expect(getDiasRestantes('2026-08-15', '2026-07-15')).toBe(31);
  });

  it('cruza fin de mes correctamente', () => {
    expect(getDiasRestantes('2026-08-01', '2026-07-31')).toBe(1);
  });
});

// ─── getUrgencyBgClass ────────────────────────────────────────

describe('getUrgencyBgClass', () => {
  it('vencido (-1 días) → error (rojo)', () => {
    const cls = getUrgencyBgClass(-1);
    expect(cls).toContain('text-error');
    expect(cls).toContain('red');
  });

  it('0 días → error (rojo)', () => {
    const cls = getUrgencyBgClass(0);
    expect(cls).toContain('text-error');
  });

  it('5 días → error (rojo)', () => {
    const cls = getUrgencyBgClass(5);
    expect(cls).toContain('text-error');
  });

  it('6 días → warning (ámbar)', () => {
    const cls = getUrgencyBgClass(6);
    expect(cls).toContain('text-warning');
    expect(cls).toContain('amber');
  });

  it('15 días → warning (ámbar)', () => {
    const cls = getUrgencyBgClass(15);
    expect(cls).toContain('text-warning');
  });

  it('16 días → info/suave (azul)', () => {
    const cls = getUrgencyBgClass(16);
    expect(cls).toContain('text-primary');
    expect(cls).toContain('blue');
  });

  it('30 días → info/suave (azul)', () => {
    const cls = getUrgencyBgClass(30);
    expect(cls).toContain('text-primary');
  });

  it('vencido muy antiguo (-365) → error', () => {
    const cls = getUrgencyBgClass(-365);
    expect(cls).toContain('text-error');
  });
});

// ─── formatDocTypeLabel ───────────────────────────────────────

describe('formatDocTypeLabel', () => {
  it('dni → "DNI"', () => {
    expect(formatDocTypeLabel('dni', null, null)).toBe('DNI');
  });

  it('licencia → label correcto', () => {
    expect(formatDocTypeLabel('licencia', null, null)).toBe('Licencia de conducir');
  });

  it('certificado gwo → "Certificado — GWO"', () => {
    expect(formatDocTypeLabel('certificado', 'gwo', null)).toBe('Certificado — GWO');
  });

  it('certificado otros con texto → muestra texto personalizado', () => {
    const label = formatDocTypeLabel('certificado', 'otros', 'Habilitación gas');
    expect(label).toContain('Habilitación gas');
    expect(label).toContain('Certificado');
  });

  it('certificado otros sin texto → muestra tipo de certificado sin texto', () => {
    const label = formatDocTypeLabel('certificado', 'otros', null);
    expect(label).toContain('Otros');
  });

  it('tipo desconocido → devuelve el tipo tal cual', () => {
    expect(formatDocTypeLabel('tipo_raro', null, null)).toBe('tipo_raro');
  });

  it('estudio_medico → label correcto', () => {
    expect(formatDocTypeLabel('estudio_medico', null, null)).toBe('Estudio médico');
  });
});

// ─── buildSupervisorMap ───────────────────────────────────────

describe('buildSupervisorMap', () => {
  const profiles: ProfileRow[] = [
    { id: 'sup-1', full_name: 'Ana Supervisora', email: 'ana@test.com', role: 'supervisor', status: 'activo', supervisor_id: null },
    { id: 'emp-1', full_name: 'Juan Empleado', email: 'juan@test.com', role: 'empleado', status: 'activo', supervisor_id: 'sup-1' },
    { id: 'emp-2', full_name: null, email: 'emp2@test.com', role: 'empleado', status: 'activo', supervisor_id: 'sup-1' },
  ];

  it('mapea id → full_name cuando existe', () => {
    const map = buildSupervisorMap(profiles);
    expect(map.get('sup-1')).toBe('Ana Supervisora');
  });

  it('usa email como fallback cuando full_name es null', () => {
    const map = buildSupervisorMap(profiles);
    expect(map.get('emp-2')).toBe('emp2@test.com');
  });

  it('ID inexistente devuelve undefined', () => {
    const map = buildSupervisorMap(profiles);
    expect(map.get('no-existe')).toBeUndefined();
  });
});

// ─── computeDocCounts ─────────────────────────────────────────

describe('computeDocCounts', () => {
  const today = '2026-07-15';

  const docs: DocRow[] = [
    // vencido
    { id: 'd1', user_id: 'u1', document_type: 'dni', certificado_tipo: null, certificado_otros_texto: null, fecha_vencimiento: '2026-07-10' },
    // por vencer (5 días)
    { id: 'd2', user_id: 'u1', document_type: 'licencia', certificado_tipo: null, certificado_otros_texto: null, fecha_vencimiento: '2026-07-20' },
    // por vencer (30 días exactos)
    { id: 'd3', user_id: 'u2', document_type: 'certificado', certificado_tipo: 'gwo', certificado_otros_texto: null, fecha_vencimiento: '2026-08-14' },
    // fuera de ventana (31 días)
    { id: 'd4', user_id: 'u2', document_type: 'certificado', certificado_tipo: 'gwo', certificado_otros_texto: null, fecha_vencimiento: '2026-08-15' },
  ];

  it('cuenta vencidos correctamente para u1', () => {
    const counts = computeDocCounts(docs, today);
    expect(counts.get('u1')?.vencidos).toBe(1);
  });

  it('cuenta por_vencer correctamente para u1', () => {
    const counts = computeDocCounts(docs, today);
    expect(counts.get('u1')?.por_vencer).toBe(1);
  });

  it('doc en exactamente 30 días cuenta como por_vencer', () => {
    const counts = computeDocCounts(docs, today);
    expect(counts.get('u2')?.por_vencer).toBe(1);
  });

  it('doc en 31 días NO cuenta (fuera de ventana)', () => {
    const counts = computeDocCounts(docs, today);
    expect(counts.get('u2')?.vencidos).toBe(0);
  });

  it('usuario sin documentos devuelve undefined (no se crea entrada)', () => {
    const counts = computeDocCounts(docs, today);
    expect(counts.get('u-sin-docs')).toBeUndefined();
  });

  it('sin documentos devuelve mapa vacío', () => {
    const counts = computeDocCounts([], today);
    expect(counts.size).toBe(0);
  });
});

// ─── buildProximosAVencer ─────────────────────────────────────

describe('buildProximosAVencer', () => {
  const today = '2026-07-15';

  const profiles: ProfileRow[] = [
    { id: 'u1', full_name: 'María García', email: 'maria@test.com', role: 'empleado', status: 'activo', supervisor_id: null },
    { id: 'u2', full_name: 'Pedro López', email: 'pedro@test.com', role: 'empleado', status: 'activo', supervisor_id: null },
  ];

  const docs: DocRow[] = [
    // vencido hace 5 días
    { id: 'd1', user_id: 'u1', document_type: 'dni', certificado_tipo: null, certificado_otros_texto: null, fecha_vencimiento: '2026-07-10' },
    // por vencer en 10 días
    { id: 'd2', user_id: 'u2', document_type: 'licencia', certificado_tipo: null, certificado_otros_texto: null, fecha_vencimiento: '2026-07-25' },
    // por vencer en 2 días
    { id: 'd3', user_id: 'u1', document_type: 'certificado', certificado_tipo: 'gwo', certificado_otros_texto: null, fecha_vencimiento: '2026-07-17' },
    // fuera de ventana (31 días) → NO incluir
    { id: 'd4', user_id: 'u2', document_type: 'certificado', certificado_tipo: 'gwo', certificado_otros_texto: null, fecha_vencimiento: '2026-08-15' },
  ];

  it('incluye documentos vencidos', () => {
    const rows = buildProximosAVencer(docs, profiles, today);
    expect(rows.some((r) => r.doc_id === 'd1')).toBe(true);
  });

  it('incluye documentos por vencer ≤ 30 días', () => {
    const rows = buildProximosAVencer(docs, profiles, today);
    expect(rows.some((r) => r.doc_id === 'd2')).toBe(true);
    expect(rows.some((r) => r.doc_id === 'd3')).toBe(true);
  });

  it('excluye documentos fuera de la ventana (31 días)', () => {
    const rows = buildProximosAVencer(docs, profiles, today);
    expect(rows.some((r) => r.doc_id === 'd4')).toBe(false);
  });

  it('ordena por dias_restantes ascendente (más vencido primero)', () => {
    const rows = buildProximosAVencer(docs, profiles, today);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].dias_restantes).toBeGreaterThanOrEqual(rows[i - 1].dias_restantes);
    }
  });

  it('el primero en la lista es el más vencido o urgente', () => {
    const rows = buildProximosAVencer(docs, profiles, today);
    expect(rows[0].doc_id).toBe('d1'); // vencido hace 5 días → dias = -5
  });

  it('resuelve el nombre del empleado correctamente', () => {
    const rows = buildProximosAVencer(docs, profiles, today);
    const rowU1 = rows.find((r) => r.doc_id === 'd1');
    expect(rowU1?.empleado_name).toBe('María García');
  });

  it('usa email como fallback si full_name es null', () => {
    const profilesSinNombre: ProfileRow[] = [
      { id: 'u3', full_name: null, email: 'sinombre@test.com', role: 'empleado', status: 'activo', supervisor_id: null },
    ];
    const docsSinNombre: DocRow[] = [
      { id: 'd5', user_id: 'u3', document_type: 'dni', certificado_tipo: null, certificado_otros_texto: null, fecha_vencimiento: '2026-07-10' },
    ];
    const rows = buildProximosAVencer(docsSinNombre, profilesSinNombre, today);
    expect(rows[0].empleado_name).toBe('sinombre@test.com');
  });

  it('resultado vacío cuando no hay docs en ventana', () => {
    const rows = buildProximosAVencer(
      [{ id: 'd9', user_id: 'u1', document_type: 'dni', certificado_tipo: null, certificado_otros_texto: null, fecha_vencimiento: '2026-08-20' }],
      profiles,
      today
    );
    expect(rows).toHaveLength(0);
  });
});

// ─── buildProfilesWithCounts ──────────────────────────────────

describe('buildProfilesWithCounts', () => {
  const profiles: ProfileRow[] = [
    { id: 'emp', full_name: 'Carlos', email: 'carlos@test.com', role: 'empleado', status: 'activo', supervisor_id: 'sup' },
    { id: 'sup', full_name: 'Laura', email: 'laura@test.com', role: 'supervisor', status: 'activo', supervisor_id: null },
  ];

  const docCounts = new Map([
    ['emp', { vencidos: 2, por_vencer: 1 }],
  ]);

  const supervisorMap = new Map([
    ['sup', 'Laura'],
  ]);

  it('agrega contadores correctos al perfil', () => {
    const result = buildProfilesWithCounts(profiles, docCounts, supervisorMap);
    const emp = result.find((p) => p.id === 'emp')!;
    expect(emp.doc_vencidos).toBe(2);
    expect(emp.doc_por_vencer).toBe(1);
  });

  it('resuelve supervisor_name correctamente', () => {
    const result = buildProfilesWithCounts(profiles, docCounts, supervisorMap);
    const emp = result.find((p) => p.id === 'emp')!;
    expect(emp.supervisor_name).toBe('Laura');
  });

  it('supervisor_name es null cuando no hay supervisor_id', () => {
    const result = buildProfilesWithCounts(profiles, docCounts, supervisorMap);
    const sup = result.find((p) => p.id === 'sup')!;
    expect(sup.supervisor_name).toBeNull();
  });

  it('perfil sin documentos tiene contadores en 0', () => {
    const result = buildProfilesWithCounts(profiles, docCounts, supervisorMap);
    const sup = result.find((p) => p.id === 'sup')!;
    expect(sup.doc_vencidos).toBe(0);
    expect(sup.doc_por_vencer).toBe(0);
  });
});

// ─── formatDate ───────────────────────────────────────────────

describe('formatDate', () => {
  it('formatea YYYY-MM-DD a DD/MM/YYYY', () => {
    expect(formatDate('2026-07-15')).toBe('15/07/2026');
  });

  it('formatea correctamente con ceros a la izquierda', () => {
    expect(formatDate('2026-01-05')).toBe('05/01/2026');
  });
});

// ─── formatDiasRestantes ──────────────────────────────────────

describe('formatDiasRestantes', () => {
  it('0 días → "Hoy"', () => {
    expect(formatDiasRestantes(0)).toBe(copy.equipo.diasHoy);
  });

  it('días positivos incluyen número', () => {
    const label = formatDiasRestantes(5);
    expect(label).toContain('5');
  });

  it('singular para 1 día', () => {
    const label = formatDiasRestantes(1);
    expect(label).toContain(copy.equipo.diaLabel);
  });

  it('plural para 2+ días', () => {
    const label = formatDiasRestantes(2);
    expect(label).toContain(copy.equipo.diasLabel);
  });

  it('días negativos usan copy.equipo.diasHace', () => {
    const label = formatDiasRestantes(-3);
    expect(label).toContain(copy.equipo.diasHace);
    expect(label).toContain('3');
  });
});

// ─── Copy: claves del módulo equipo ───────────────────────────

describe('copy.equipo: claves requeridas', () => {
  it('tiene título y subtítulo', () => {
    expect(copy.equipo.title).toBeTruthy();
    expect(copy.equipo.subtitle).toBeTruthy();
  });

  it('tiene textos de búsqueda y filtro', () => {
    expect(copy.equipo.search).toBeTruthy();
    expect(copy.equipo.filtroEstado).toBeTruthy();
    expect(copy.equipo.todoEstado).toBeTruthy();
  });

  it('tiene todas las columnas de la tabla de perfiles', () => {
    expect(copy.equipo.table.nombre).toBeTruthy();
    expect(copy.equipo.table.email).toBeTruthy();
    expect(copy.equipo.table.rol).toBeTruthy();
    expect(copy.equipo.table.supervisor).toBeTruthy();
    expect(copy.equipo.table.estado).toBeTruthy();
    expect(copy.equipo.table.docVencidos).toBeTruthy();
    expect(copy.equipo.table.docPorVencer).toBeTruthy();
  });

  it('tiene textos del panel "Próximos a vencer"', () => {
    expect(copy.equipo.proximosAVencer.title).toBeTruthy();
    expect(copy.equipo.proximosAVencer.subtitle).toBeTruthy();
    expect(copy.equipo.proximosAVencer.noItems).toBeTruthy();
    expect(copy.equipo.proximosAVencer.table.empleado).toBeTruthy();
    expect(copy.equipo.proximosAVencer.table.documento).toBeTruthy();
    expect(copy.equipo.proximosAVencer.table.vencimiento).toBeTruthy();
    expect(copy.equipo.proximosAVencer.table.diasRestantes).toBeTruthy();
  });

  it('textos en español (es-AR) — sin texto en inglés', () => {
    expect(copy.equipo.title).not.toMatch(/team/i);
    expect(copy.equipo.proximosAVencer.title).not.toMatch(/upcoming/i);
    expect(copy.equipo.table.docVencidos).not.toMatch(/expired/i);
  });
});
