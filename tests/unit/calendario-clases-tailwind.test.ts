/**
 * Tests unitarios — Las clases de fondo del calendario existen en el CSS
 * compilado (FB-F3-FIX-01, bug recO3SGuYGiB2qEJ3)
 *
 * ESTE es el guard del hueco que dejó pasar el bug. El test viejo afirmaba
 * el STRING que devuelve getCellVisual() (`toBe('bg-calendar-enFranco/35')`)
 * y pasaba en verde mientras esa clase no existía en el CSS: Tailwind v3
 * (JIT) hace match de texto plano sobre los archivos de `content` y solo
 * emite las clases que encuentra escritas LITERALES, y la variante estimada
 * se componía en runtime (`${base}/35`). El atributo class llegaba al DOM,
 * el CSS no lo definía, y la celda quedaba transparente (blanca).
 *
 * Acá se compila Tailwind con la configuración REAL del proyecto y se
 * verifica que cada clase del SSOT termine efectivamente en el CSS, pintando
 * un background-color. Un test de string no puede probar esto; este sí.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '@/tailwind.config';
import {
  ESTADO_BG_CLASS,
  ESTADO_BG_CLASS_ESTIMADO,
  CELDA_VACIA_BG_CLASS,
} from '@/app/(app)/calendario/utils';

// Compila las utilities de Tailwind escaneando el `content` real del
// proyecto (los mismos globs que usa `next build`), una sola vez, y arma un
// índice selector → declaraciones recorriendo el AST de postcss (no parseando
// el texto del CSS a mano: el formateo — espacios, saltos de línea, minificado
// — no debe poder hacer fallar ni, peor, pasar en falso a este guard).
let cssVacio = true;
const declaracionesPorSelector = new Map<string, string>();

beforeAll(async () => {
  const result = await postcss([tailwindcss(tailwindConfig)]).process('@tailwind utilities;', {
    from: undefined,
  });
  cssVacio = result.css.trim().length === 0;
  result.root.walkRules((rule) => {
    const previo = declaracionesPorSelector.get(rule.selector) ?? '';
    declaracionesPorSelector.set(rule.selector, `${previo}${rule.nodes.map(String).join(';')};`);
  });
}, 60_000);

// En el CSS, la "/" del modificador de opacidad va escapada:
// `bg-calendar-enFranco/35` se emite como el selector `.bg-calendar-enFranco\/35`.
function ruleFor(className: string): string | undefined {
  return declaracionesPorSelector.get(`.${className.replace(/\//g, '\\/')}`);
}

const TODAS_LAS_CLASES = [
  ...Object.values(ESTADO_BG_CLASS),
  ...Object.values(ESTADO_BG_CLASS_ESTIMADO),
  CELDA_VACIA_BG_CLASS,
];

describe('clases de fondo del calendario en el CSS compilado', () => {
  it('el CSS compiló y no está vacío (sanity: si esto falla, el resto no prueba nada)', () => {
    expect(cssVacio).toBe(false);
    expect(ruleFor(ESTADO_BG_CLASS.trabajando)).toBeDefined();
  });

  it.each(TODAS_LAS_CLASES)('la clase %s existe en el CSS y pinta un background-color', (clase) => {
    const declaraciones = ruleFor(clase);
    expect(
      declaraciones,
      `La clase "${clase}" NO se emitió al CSS. Tailwind solo genera las clases que ` +
        'encuentra escritas literales en los archivos de `content`: revisá que no se esté ' +
        'componiendo el nombre con un template literal (ver el SSOT en calendario/utils.ts).'
    ).toBeDefined();
    expect(declaraciones).toContain('background-color');
  });

  it('las 4 variantes estimadas existen (no solo la de trabajando)', () => {
    // El bug original dejaba viva únicamente `bg-calendar-trabajando/35`,
    // porque era la única que aparecía literal (en Legend.tsx). Las otras
    // tres — en_franco incluida, la del reporte de prod — no existían.
    for (const clase of Object.values(ESTADO_BG_CLASS_ESTIMADO)) {
      expect(ruleFor(clase), `falta la variante estimada "${clase}"`).toBeDefined();
    }
  });

  it('la variante estimada es translúcida y la real es opaca (distinguibles a la vista)', () => {
    // Estimado al 35%: alpha explícito en el color. Real: sin alpha reducido.
    // Si ambas quedaran iguales, el admin no podría distinguir planificado de
    // real — la intención visual del PRD Fase 3 #2.
    for (const estado of Object.keys(ESTADO_BG_CLASS_ESTIMADO) as (keyof typeof ESTADO_BG_CLASS_ESTIMADO)[]) {
      const estimada = ruleFor(ESTADO_BG_CLASS_ESTIMADO[estado])!;
      const real = ruleFor(ESTADO_BG_CLASS[estado])!;
      // El alfa se emite como `rgb(r g b / 0.35)` sin minificar y como
      // `rgba(r,g,b,.35)` minificado — se afirma el 0.35 en cualquiera de
      // las dos formas, para no atar el test al formateo del output.
      expect(estimada, `"${estado}" estimado debería ser translúcido`).toMatch(/0?\.35/);
      expect(real, `"${estado}" real debería ser opaco`).not.toMatch(/0?\.35/);
      expect(estimada).not.toBe(real);
    }
  });
});
