/**
 * FB-F4-06 — AprobacionesTable: previsualización de sobrescritura, contrato
 * de estado por request ({status:'ok', days} | {status:'error'}).
 *
 * Cubre, con render real (Testing Library) y las server actions mockeadas
 * (no se invocan en estos tests, solo se renderiza la tabla):
 *  - status:'error' → copy de error visible, NO la lista de días.
 *  - status:'ok' con days=[] → sin aviso (nada que sobrescribir).
 *  - status:'ok' con days>0 → aviso con los días (incl. es_estimado).
 *  - En los tres casos, Aprobar/Rechazar siguen habilitados (no bloqueante).
 */

import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/(app)/aprobaciones/actions', () => ({
  approveDocument: vi.fn(),
  rejectDocument: vi.fn(),
}));
vi.mock('@/app/(app)/aprobaciones/ausencia-actions', () => ({
  approveAusencia: vi.fn(),
  rejectAusencia: vi.fn(),
}));

import { AprobacionesTable, type PendingItem } from '@/app/(app)/aprobaciones/AprobacionesTable';
import { copy } from '@/lib/copy';
import type { AusenciaRequest } from '@/lib/db-types';

function ausenciaItem(id: string, userId: string): PendingItem {
  return {
    kind: 'ausencia',
    data: {
      id,
      user_id: userId,
      motivo_ausencia: 'vacaciones',
      fecha_inicio: '2027-03-15',
      fecha_fin: '2027-03-17',
      notas: null,
      estado: 'pendiente',
      motivo_rechazo: null,
      motivo_otros_texto: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2027-03-01T00:00:00Z',
      updated_at: '2027-03-01T00:00:00Z',
      user_profile: { full_name: `Empleado ${userId}`, email: `${userId}@test.com` },
    } as unknown as AusenciaRequest & { user_profile: { full_name: string; email: string } },
  };
}

describe('AprobacionesTable: previsualización de sobrescritura — status:"error" (FB-F4-06)', () => {
  it('muestra el copy de error visible, no la lista de días ni el silencio de "sin días"', () => {
    render(
      <AprobacionesTable
        items={[ausenciaItem('req-1', 'emp-1')]}
        overwriteStatusByRequest={{ 'req-1': { status: 'error' } }}
      />
    );
    expect(screen.getByText(copy.aprobaciones.sobrescritura.error)).toBeInTheDocument();
    expect(screen.queryByText(copy.aprobaciones.sobrescritura.aviso)).not.toBeInTheDocument();
  });

  it('no bloquea: Aprobar y Rechazar siguen habilitados', () => {
    render(
      <AprobacionesTable
        items={[ausenciaItem('req-1', 'emp-1')]}
        overwriteStatusByRequest={{ 'req-1': { status: 'error' } }}
      />
    );
    expect(screen.getByText(copy.aprobaciones.actions.aprobar)).not.toBeDisabled();
    expect(screen.getByText(copy.aprobaciones.actions.rechazar)).not.toBeDisabled();
  });
});

describe('AprobacionesTable: previsualización de sobrescritura — status:"ok" (FB-F4-06)', () => {
  it('days=[]: no muestra aviso ni error (nada que sobrescribir)', () => {
    render(
      <AprobacionesTable
        items={[ausenciaItem('req-1', 'emp-1')]}
        overwriteStatusByRequest={{ 'req-1': { status: 'ok', days: [] } }}
      />
    );
    expect(screen.queryByText(copy.aprobaciones.sobrescritura.aviso)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.aprobaciones.sobrescritura.error)).not.toBeInTheDocument();
  });

  it('days con contenido (incl. es_estimado=true): muestra el aviso con los días — regresión FB-F4-05', () => {
    render(
      <AprobacionesTable
        items={[ausenciaItem('req-1', 'emp-1')]}
        overwriteStatusByRequest={{
          'req-1': {
            status: 'ok',
            days: [
              { fecha: '2027-03-16', estado_dia: 'trabajando', es_estimado: true },
            ],
          },
        }}
      />
    );
    expect(screen.getByText(copy.aprobaciones.sobrescritura.aviso)).toBeInTheDocument();
    expect(screen.queryByText(copy.aprobaciones.sobrescritura.error)).not.toBeInTheDocument();
  });

  it('sin entrada en overwriteStatusByRequest (prop opcional): no rompe el render, sin aviso', () => {
    render(<AprobacionesTable items={[ausenciaItem('req-1', 'emp-1')]} />);
    expect(screen.queryByText(copy.aprobaciones.sobrescritura.aviso)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.aprobaciones.sobrescritura.error)).not.toBeInTheDocument();
  });
});
