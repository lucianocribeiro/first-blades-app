/**
 * FB-ADJ-01: renombre de etiqueta "Formularios" → "Ingreso" en el menú y en
 * el título de página — solo la etiqueta cambia. La ruta (/formularios) y el
 * contenido "próximamente" del módulo no se tocan (ver
 * app/(app)/formularios/page.tsx, sin cambios).
 */

import { describe, it, expect } from 'vitest';
import { copy } from '@/lib/copy';
import { canAccess } from '@/lib/roles';

describe('Renombre "Formularios" → "Ingreso" (FB-ADJ-01)', () => {
  it('la etiqueta de nav es "Ingreso", no "Formularios"', () => {
    expect(copy.nav.formularios).toBe('Ingreso');
  });

  it('el título de la topbar de la página es "Ingreso"', () => {
    expect(copy.pages.formularios.title).toBe('Ingreso');
  });

  it('el subtítulo de la página no cambia (contenido intacto, solo la etiqueta)', () => {
    expect(copy.pages.formularios.subtitle).toBe('Formularios de ingreso y precarga');
  });

  it('la ruta/roleAccess sigue igual — misma visibilidad por rol que antes del renombre', () => {
    expect(canAccess('admin', 'formularios')).toBe(true);
    expect(canAccess('supervisor', 'formularios')).toBe(true);
    expect(canAccess('empleado', 'formularios')).toBe(true);
  });
});
