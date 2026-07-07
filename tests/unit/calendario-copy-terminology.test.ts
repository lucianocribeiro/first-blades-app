/**
 * FB-F3-12: ningún término técnico debe quedar visible en el copy del
 * módulo Calendario. Recorre recursivamente `copy.calendario` (incluye
 * `meses`, arrays y objetos anidados) buscando las palabras que el PRD
 * pide reemplazar por lenguaje amigable.
 */
import { describe, it, expect } from 'vitest';
import { copy } from '@/lib/copy';

const TERMINOS_PROHIBIDOS = ['racha', 'umbral', 'estimado', 'estimados', 'sin cargar', 'franco excedido'];

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

describe('copy.calendario — sin terminología técnica visible (FB-F3-12)', () => {
  const strings = collectStrings(copy.calendario);

  it.each(TERMINOS_PROHIBIDOS)('ningún string visible contiene "%s"', (termino) => {
    const ofensores = strings.filter((s) => s.toLowerCase().includes(termino));
    expect(ofensores).toEqual([]);
  });
});
