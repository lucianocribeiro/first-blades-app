/**
 * FB-F4-17 — Cobertura RTL de `{ ok: false, error }`: la implementación ya
 * muestra el error en `!ok` en los tres call sites afectados por FB-F4-16
 * (Codex, FB-F4-AUD-12), pero los unitarios existentes probaban sobre todo
 * que las ACTIONS devuelven `{ok:false}` (mockeando Supabase), no que cada
 * COMPONENTE lo renderiza de verdad. Sin este test, un futuro cambio podría
 * volver a tragarse un error sin que nada lo note (aprendizaje Fase 3:
 * errores visibles, no tragados).
 *
 * Un caso por clase de call site (no se duplican todos los copies de
 * error — alcanza con probar el camino de render):
 *  - AprobacionesTable (aprobar/rechazar ausencia o pasaje).
 *  - SolicitudPasajeForm (crear pasaje).
 * El tercer caso (SolicitudAusenciaForm) vive en solicitud-ausencia-form.test.tsx,
 * junto al resto de los tests de ese componente.
 *
 * Solo archivos de test — componentes y actions ya eran correctos (FB-F4-16).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/app/(app)/aprobaciones/actions', () => ({
  approveDocument: vi.fn(),
  rejectDocument: vi.fn(),
}));
vi.mock('@/app/(app)/aprobaciones/ausencia-actions', () => ({
  approveAusencia: vi.fn(),
  rejectAusencia: vi.fn(),
}));
vi.mock('@/app/(app)/aprobaciones/pasaje-actions', () => ({
  approvePasaje: vi.fn(),
  rejectPasaje: vi.fn(),
}));
vi.mock('@/app/(app)/solicitud-pasaje/actions', () => ({
  createPasajeRequest: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { AprobacionesTable, type PendingItem } from '@/app/(app)/aprobaciones/AprobacionesTable';
import { approveAusencia } from '@/app/(app)/aprobaciones/ausencia-actions';
import { SolicitudPasajeForm } from '@/app/(app)/solicitud-pasaje/SolicitudPasajeForm';
import { createPasajeRequest } from '@/app/(app)/solicitud-pasaje/actions';
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

describe('AprobacionesTable: {ok:false} de la action se muestra (FB-F4-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approveAusencia devuelve {ok:false, error} → el error se renderiza, el éxito NO se muestra', async () => {
    vi.mocked(approveAusencia).mockResolvedValueOnce({
      ok: false,
      error: copy.aprobaciones.messages.alreadyResolved,
    });

    render(<AprobacionesTable items={[ausenciaItem('req-1', 'emp-1')]} />);
    fireEvent.click(screen.getByRole('button', { name: copy.aprobaciones.actions.aprobar }));

    await waitFor(() =>
      expect(screen.getByText(copy.aprobaciones.messages.alreadyResolved)).toBeInTheDocument()
    );
    // Ni el aviso de "mail no enviado" ni ningún indicio de éxito — el error
    // cortó el flujo, no lo tragó una rama de éxito silenciosa.
    expect(screen.queryByText(copy.aprobaciones.messages.resolvedEmailFailed)).not.toBeInTheDocument();
  });
});

describe('SolicitudPasajeForm: {ok:false} de createPasajeRequest se muestra (FB-F4-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('la action devuelve {ok:false, error} → el error se renderiza y el éxito NO se muestra', async () => {
    vi.mocked(createPasajeRequest).mockResolvedValueOnce({
      ok: false,
      error: copy.solicitudPasaje.errors.empleadoFueraDeEquipo,
    });

    render(<SolicitudPasajeForm team={[]} showEmpleadoSelector={false} isAdmin={false} />);

    fireEvent.change(screen.getByLabelText(copy.solicitudPasaje.fields.motivoViaje, { exact: false }), {
      target: { value: 'traslado_proyectos' },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudPasaje.fields.origen, { exact: false }), {
      target: { value: 'Base' },
    });
    fireEvent.change(screen.getByLabelText(copy.solicitudPasaje.fields.destino, { exact: false }), {
      target: { value: 'Sitio' },
    });
    fireEvent.change(
      screen.getByLabelText(`${copy.solicitudPasaje.fields.diasViaje} 1`, { exact: false }),
      { target: { value: '2027-06-16' } }
    );

    fireEvent.click(screen.getByRole('button', { name: copy.solicitudPasaje.submitButton }));

    await waitFor(() =>
      expect(screen.getByText(copy.solicitudPasaje.errors.empleadoFueraDeEquipo)).toBeInTheDocument()
    );
    expect(screen.queryByText(copy.solicitudPasaje.messages.success)).not.toBeInTheDocument();
  });
});
