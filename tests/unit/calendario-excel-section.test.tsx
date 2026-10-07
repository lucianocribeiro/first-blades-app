/**
 * FB-PI-12 — Bloque colapsable de Importar / Exportar Excel
 * (app/(app)/calendario/ExcelImportExportSection.tsx).
 *
 * Cubre: arranca CERRADO siempre (no recuerda estado: ni cookie ni
 * localStorage), se abre y se cierra con un <button> nativo (teclado),
 * aria-expanded anuncia el estado, y cerrado no renderiza los paneles.
 * Quién lo recibe (solo admin) lo cubre calendario-server-boundary.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExcelImportExportSection } from '@/app/(app)/calendario/ExcelImportExportSection';
import { copy } from '@/lib/copy';

const TITLE = copy.calendario.excel.seccion.title;

function renderSection() {
  return render(
    <ExcelImportExportSection>
      <p>Panel de export</p>
      <p>Panel de import</p>
    </ExcelImportExportSection>
  );
}

beforeEach(() => {
  document.cookie = '';
  window.localStorage.clear();
});

describe('ExcelImportExportSection', () => {
  it('arranca cerrado: aria-expanded=false y sin los paneles en el DOM', () => {
    renderSection();
    const header = screen.getByRole('button', { name: new RegExp(TITLE) });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Panel de export')).not.toBeInTheDocument();
    expect(screen.queryByText('Panel de import')).not.toBeInTheDocument();
  });

  it('se abre y se cierra desde el encabezado, que es un <button> nativo (operable por teclado)', () => {
    renderSection();
    const header = screen.getByRole('button', { name: new RegExp(TITLE) });
    expect(header.tagName).toBe('BUTTON');
    expect(header).toHaveAttribute('type', 'button');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Panel de export')).toBeInTheDocument();
    expect(screen.getByText('Panel de import')).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Panel de export')).not.toBeInTheDocument();
  });

  it('no recuerda el estado: abierto y remontado, vuelve a arrancar cerrado (sin cookie ni localStorage)', () => {
    const { unmount } = renderSection();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TITLE) }));
    unmount();

    renderSection();
    expect(screen.getByRole('button', { name: new RegExp(TITLE) })).toHaveAttribute('aria-expanded', 'false');
    expect(document.cookie).toBe('');
    expect(window.localStorage.length).toBe(0);
  });
});
