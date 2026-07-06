/**
 * Tests unitarios — preferencia de colapsado del módulo Calendario (FB-F3-11)
 *
 * parseCollapseState es la función pura que decide qué mostrar en el
 * render inicial (server component) a partir del valor crudo de la
 * cookie: cubre el default (sin cookie), una cookie válida, y cookies
 * malformadas/con forma inválida (nunca debe romper el render).
 */

import { describe, it, expect } from 'vitest';
import {
  parseCollapseState,
  DEFAULT_COLLAPSE_STATE,
  COLLAPSE_COOKIE_NAME,
} from '@/app/(app)/calendario/collapseState';

describe('parseCollapseState', () => {
  it('sin cookie (undefined): usa el default (calendario expandido; alertas y resumen, colapsados)', () => {
    expect(parseCollapseState(undefined)).toEqual(DEFAULT_COLLAPSE_STATE);
    expect(DEFAULT_COLLAPSE_STATE).toEqual({ alertas: false, resumen: false, calendario: true });
  });

  it('cookie válida: devuelve exactamente los valores guardados, aunque difieran del default', () => {
    const raw = JSON.stringify({ alertas: true, resumen: true, calendario: false });
    expect(parseCollapseState(raw)).toEqual({ alertas: true, resumen: true, calendario: false });
  });

  it('JSON malformado: cae al default sin lanzar', () => {
    expect(parseCollapseState('{esto no es json')).toEqual(DEFAULT_COLLAPSE_STATE);
  });

  it('JSON válido pero con forma inválida (falta una clave): cae al default', () => {
    expect(parseCollapseState(JSON.stringify({ alertas: true }))).toEqual(DEFAULT_COLLAPSE_STATE);
  });

  it('JSON válido pero con tipos inválidos (strings en vez de booleans): cae al default', () => {
    const raw = JSON.stringify({ alertas: 'true', resumen: 'false', calendario: 'true' });
    expect(parseCollapseState(raw)).toEqual(DEFAULT_COLLAPSE_STATE);
  });

  it('JSON de un array o valor primitivo: cae al default', () => {
    expect(parseCollapseState(JSON.stringify([true, false, true]))).toEqual(DEFAULT_COLLAPSE_STATE);
    expect(parseCollapseState('42')).toEqual(DEFAULT_COLLAPSE_STATE);
  });

  it('cadena vacía: cae al default', () => {
    expect(parseCollapseState('')).toEqual(DEFAULT_COLLAPSE_STATE);
  });
});

describe('COLLAPSE_COOKIE_NAME', () => {
  it('es un nombre de cookie no vacío', () => {
    expect(typeof COLLAPSE_COOKIE_NAME).toBe('string');
    expect(COLLAPSE_COOKIE_NAME.length).toBeGreaterThan(0);
  });
});
