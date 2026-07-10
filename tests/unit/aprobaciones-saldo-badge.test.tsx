/**
 * FB-F3-21 — Badge de saldo de días de trámite en la cola de aprobación.
 *
 * Cubre, con render real (Testing Library) y las server actions mockeadas
 * (no se invocan en estos tests, solo se renderiza la tabla):
 *  - El badge refleja el consumo real del solicitante ("Usó X de 3").
 *  - Estado excedido se distingue visualmente ("X/3 — excede").
 *  - Los items kind='documento' nunca muestran el badge (no aplica).
 *  - Un solicitante sin entrada en saldoByUser no rompe el render (sin badge).
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
import type { AusenciaRequest, Document } from '@/lib/db-types';

function ausenciaItem(id: string, userId: string): PendingItem {
  return {
    kind: 'ausencia',
    data: {
      id,
      user_id: userId,
      motivo_ausencia: 'dia_tramite',
      fecha_inicio: '2027-03-15',
      fecha_fin: '2027-03-15',
      notas: null,
      estado: 'pendiente',
      motivo_rechazo: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2027-03-01T00:00:00Z',
      updated_at: '2027-03-01T00:00:00Z',
      user_profile: { full_name: `Empleado ${userId}`, email: `${userId}@test.com` },
    } as unknown as AusenciaRequest & { user_profile: { full_name: string; email: string } },
  };
}

function documentoItem(id: string, userId: string): PendingItem {
  return {
    kind: 'documento',
    data: {
      id,
      user_id: userId,
      document_type: 'dni',
      filename: 'dni.pdf',
      storage_path: `${userId}/dni.pdf`,
      file_size: 100,
      mime_type: 'application/pdf',
      estado: 'pendiente',
      motivo_rechazo: null,
      uploaded_by: userId,
      reviewed_by: null,
      reviewed_at: null,
      certificado_tipo: null,
      certificado_otros_texto: null,
      fecha_vencimiento: null,
      file_purged_at: null,
      created_at: '2027-03-01T00:00:00Z',
      updated_at: '2027-03-01T00:00:00Z',
      user_profile: { full_name: `Empleado ${userId}`, email: `${userId}@test.com` },
    } as unknown as Document & { user_profile: { full_name: string; email: string } },
  };
}

describe('AprobacionesTable: badge de saldo de días de trámite', () => {
  it('muestra "Usó X de 3" para un solicitante sin exceder el tope', () => {
    render(
      <AprobacionesTable
        items={[ausenciaItem('req-1', 'emp-1')]}
        saldoByUser={{ 'emp-1': { consumidos: 2, excedido: false } }}
      />
    );
    expect(screen.getByText(`${copy.aprobaciones.badgeSaldo.usado} 2 ${copy.aprobaciones.badgeSaldo.de} 3`)).toBeInTheDocument();
  });

  it('muestra "X/3 — excede" para un solicitante que ya excedió el tope', () => {
    render(
      <AprobacionesTable
        items={[ausenciaItem('req-1', 'emp-1')]}
        saldoByUser={{ 'emp-1': { consumidos: 4, excedido: true } }}
      />
    );
    expect(screen.getByText(`4/3 — ${copy.aprobaciones.badgeSaldo.excede}`)).toBeInTheDocument();
  });

  it('un item kind=documento nunca muestra el badge, aunque su user_id tenga entrada en saldoByUser', () => {
    render(
      <AprobacionesTable
        items={[documentoItem('doc-1', 'emp-1')]}
        saldoByUser={{ 'emp-1': { consumidos: 2, excedido: false } }}
      />
    );
    expect(screen.queryByText(new RegExp(copy.aprobaciones.badgeSaldo.usado))).not.toBeInTheDocument();
  });

  it('un solicitante sin entrada en saldoByUser no rompe el render (sin badge)', () => {
    render(<AprobacionesTable items={[ausenciaItem('req-1', 'emp-sin-saldo')]} saldoByUser={{}} />);
    expect(screen.queryByText(new RegExp(copy.aprobaciones.badgeSaldo.usado))).not.toBeInTheDocument();
  });

  it('saldoByUser es opcional (default {}): no rompe si no se pasa', () => {
    render(<AprobacionesTable items={[ausenciaItem('req-1', 'emp-1')]} />);
    expect(screen.queryByText(new RegExp(copy.aprobaciones.badgeSaldo.usado))).not.toBeInTheDocument();
  });
});

// FB-F3-21: "Nada de 'saldo derivado', 'es_estimado', 'umbral' visibles."
function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
  return acc;
}

describe('copy.aprobaciones — sin terminología técnica visible (FB-F3-21)', () => {
  const strings = collectStrings(copy.aprobaciones);
  const terminos = ['saldo derivado', 'es_estimado', 'umbral', 'rpc', 'enum'];

  it.each(terminos)('ningún string visible contiene "%s"', (termino) => {
    const ofensores = strings.filter((s) => s.toLowerCase().includes(termino));
    expect(ofensores).toEqual([]);
  });
});
