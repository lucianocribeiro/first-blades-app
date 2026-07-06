/**
 * Tests de render (Testing Library) — CollapsibleSection (FB-F3-11)
 *
 * Encabezado reutilizable para las 3 secciones colapsables de
 * /calendario. Cubre: toggle al clickear, aria-expanded correcto,
 * contenido no renderizado cuando está colapsada, y que es operable por
 * teclado (elemento <button> nativo, no un div con onClick).
 */

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

// Wrapper controlado: CollapsibleSection es "controlado" (expanded/onToggle
// vienen del padre, como en CalendarioSections) — este wrapper simula ese
// padre con un useState real para poder testear el toggle end-to-end.
function ControlledSection({ initialExpanded }: { initialExpanded: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  return (
    <CollapsibleSection
      title="Sección de prueba"
      subtitle="Subtítulo de prueba"
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
    >
      <p>Contenido de la sección</p>
    </CollapsibleSection>
  );
}

describe('CollapsibleSection (render)', () => {
  it('el encabezado es un <button> real (operable por teclado sin trabajo extra)', () => {
    render(
      <CollapsibleSection title="Título" expanded={true} onToggle={() => {}}>
        <p>Contenido</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole('button', { name: /Título/ })).toBeInTheDocument();
  });

  it('expandida: aria-expanded="true" y el contenido se renderiza', () => {
    render(
      <CollapsibleSection title="Título" expanded={true} onToggle={() => {}}>
        <p>Contenido visible</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Contenido visible')).toBeInTheDocument();
  });

  it('colapsada: aria-expanded="false" y el contenido NO se renderiza', () => {
    render(
      <CollapsibleSection title="Título" expanded={false} onToggle={() => {}}>
        <p>Contenido oculto</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Contenido oculto')).not.toBeInTheDocument();
  });

  it('clickear el encabezado invoca onToggle', () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection title="Título" expanded={false} onToggle={onToggle}>
        <p>Contenido</p>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clickear el encabezado alterna expandido/colapsado (extremo a extremo, con estado real)', () => {
    render(<ControlledSection initialExpanded={false} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Contenido de la sección')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Contenido de la sección')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Contenido de la sección')).not.toBeInTheDocument();
  });

  it('el subtítulo solo se muestra cuando está expandida (colapsada, solo el título)', () => {
    const { rerender } = render(
      <CollapsibleSection title="Título" subtitle="Un subtítulo" expanded={false} onToggle={() => {}}>
        <p>Contenido</p>
      </CollapsibleSection>
    );
    expect(screen.queryByText('Un subtítulo')).not.toBeInTheDocument();

    rerender(
      <CollapsibleSection title="Título" subtitle="Un subtítulo" expanded={true} onToggle={() => {}}>
        <p>Contenido</p>
      </CollapsibleSection>
    );
    expect(screen.getByText('Un subtítulo')).toBeInTheDocument();
  });
});
