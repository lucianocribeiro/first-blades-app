/**
 * FB-F4-18 — Cobertura RTL de `{ ok: false, error }` en el flujo de
 * documentos: mismo patrón que FB-F4-16/17 (ausencia/pasaje), ahora para
 * `approveDocument`/`rejectDocument` (AprobacionesTable) y
 * `handleDocumentUpload`/`uploadDocumentForEmployee` (los dos modales de
 * carga). Antes de este fix, las 4 actions tiraban `throw new
 * Error(mensajeAmigable)` — Next.js redacta ese mensaje en un build de
 * producción aunque el cliente lo atrape con try/catch (ver
 * docs/prompts/FB-F4-14.md §8, confirmado con FB-F4-16). Cada test acá
 * verifica que el componente MUESTRA el `error` del resultado, no que lo
 * trague una rama de éxito.
 *
 * Solo archivos de test — componentes y actions ya convertidos en FB-F4-18.
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
vi.mock('@/app/(app)/mi-perfil/actions', () => ({
  handleDocumentUpload: vi.fn(),
  uploadDocumentForEmployee: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { AprobacionesTable, type PendingItem } from '@/app/(app)/aprobaciones/AprobacionesTable';
import { approveDocument } from '@/app/(app)/aprobaciones/actions';
import { DocumentUploadModal } from '@/app/(app)/mi-perfil/DocumentUploadModal';
import { handleDocumentUpload } from '@/app/(app)/mi-perfil/actions';
import { AdminDocumentUploadModal } from '@/app/(app)/mi-perfil/AdminDocumentUploadModal';
import { uploadDocumentForEmployee } from '@/app/(app)/mi-perfil/actions';
import { copy } from '@/lib/copy';
import type { Document } from '@/lib/db-types';

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

function submitUploadForm(container: HTMLElement, file: File) {
  const fileInput = container.querySelector('input[type="file"]');
  if (!fileInput) throw new Error('No se encontró el input de archivo');
  fireEvent.change(fileInput, { target: { files: [file] } });

  const form = container.querySelector('form');
  if (!form) throw new Error('No se encontró el <form>');
  fireEvent.submit(form);
}

describe('AprobacionesTable (documento): {ok:false} de approveDocument se muestra (FB-F4-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approveDocument devuelve {ok:false, error} → el error se renderiza, el éxito NO se muestra', async () => {
    vi.mocked(approveDocument).mockResolvedValueOnce({
      ok: false,
      error: copy.aprobaciones.messages.approveError,
    });

    render(<AprobacionesTable items={[documentoItem('doc-1', 'emp-1')]} />);
    fireEvent.click(screen.getByRole('button', { name: copy.aprobaciones.actions.aprobar }));

    await waitFor(() =>
      expect(screen.getByText(copy.aprobaciones.messages.approveError)).toBeInTheDocument()
    );
    expect(screen.queryByText(copy.aprobaciones.messages.resolvedEmailFailed)).not.toBeInTheDocument();
  });
});

describe('DocumentUploadModal: {ok:false} de handleDocumentUpload se muestra (FB-F4-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('la action devuelve {ok:false, error} → el error se renderiza y el modal NO se cierra', async () => {
    vi.mocked(handleDocumentUpload).mockResolvedValueOnce({
      ok: false,
      error: `${copy.documentos.errors.tipoArchivoNoPermitido} text/plain`,
    });
    const onClose = vi.fn();

    const { container } = render(<DocumentUploadModal open onClose={onClose} />);
    const file = new File(['contenido'], 'archivo.txt', { type: 'text/plain' });
    submitUploadForm(container, file);

    await waitFor(() =>
      expect(
        screen.getByText(copy.documentos.errors.tipoArchivoNoPermitido, { exact: false })
      ).toBeInTheDocument()
    );
    // El éxito cierra el modal (onClose) — un error no debería.
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AdminDocumentUploadModal: {ok:false} de uploadDocumentForEmployee se muestra (FB-F4-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('la action devuelve {ok:false, error} → el error se renderiza y el modal NO se cierra', async () => {
    vi.mocked(uploadDocumentForEmployee).mockResolvedValueOnce({
      ok: false,
      error: copy.documentos.errors.archivoDemasiadoGrande,
    });
    const onClose = vi.fn();

    const { container } = render(
      <AdminDocumentUploadModal open onClose={onClose} employeeId="emp-1" />
    );
    const file = new File(['contenido'], 'archivo.pdf', { type: 'application/pdf' });
    submitUploadForm(container, file);

    await waitFor(() =>
      expect(screen.getByText(copy.documentos.errors.archivoDemasiadoGrande)).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
