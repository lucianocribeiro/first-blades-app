/**
 * FB-PI-05 — Helper de lectura completa (lib/supabase/fetch-all.ts).
 *
 * La fuente simula PostgREST: corta cada respuesta en `serverMaxRows` sin
 * devolver error, igual que el tope real. Se verifica que el helper:
 *   - traiga TODAS las filas, aun con el corte del servidor por debajo del
 *     tamaño de página (no corta por "página incompleta");
 *   - propague el { error } de una página intermedia y NO devuelva lo parcial;
 *   - reporte el tope de seguridad en vez de recortar;
 *   - loguee cada falla con la etiqueta de la lectura.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchAllRows } from '@/lib/supabase/fetch-all';

type Row = { n: number };

function source(total: number, opts: { serverMaxRows?: number; failAtFrom?: number } = {}) {
  const { serverMaxRows = 1000, failAtFrom } = opts;
  const rows: Row[] = Array.from({ length: total }, (_, n) => ({ n }));
  const ranges: [number, number][] = [];
  const query = () => ({
    range(from: number, to: number) {
      ranges.push([from, to]);
      if (failAtFrom !== undefined && from === failAtFrom) {
        return Promise.resolve({ data: null, error: { message: 'timeout de la base' } });
      }
      const end = Math.min(to + 1, from + serverMaxRows);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
  });
  return { query, ranges };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('fetchAllRows: lectura completa', () => {
  it('2500 filas con el tope real de 1000: devuelve las 2500, en orden y sin repetir', async () => {
    const { query, ranges } = source(2500);
    const { data, error } = await fetchAllRows(query, { label: '[test]' });

    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data!.map((r) => r.n)).toEqual(Array.from({ length: 2500 }, (_, n) => n));
    // 3 páginas con datos + 1 vacía que confirma el final.
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
  });

  it('exactamente 1000 filas (el borde del tope): devuelve las 1000', async () => {
    const { query } = source(1000);
    const { data } = await fetchAllRows(query, { label: '[test]' });
    expect(data).toHaveLength(1000);
  });

  it('exactamente 1001 filas (FB-PI-AUD-05): la 2.ª página trae UNA fila y el bucle cierra', async () => {
    const { query, ranges } = source(1001);
    const { data, error } = await fetchAllRows(query, { label: '[test]' });

    expect(error).toBeNull();
    expect(data).toHaveLength(1001);
    // La fila 1001 (n = 1000) es justo la que el corte de PostgREST dejaba afuera.
    expect(data![1000]).toEqual({ n: 1000 });
    // Página llena, página de 1 fila, página vacía que confirma el final.
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1001, 2000]]);
  });

  it('servidor con tope MENOR que la página (400 < 1000): igual trae todo', async () => {
    const { query } = source(1234, { serverMaxRows: 400 });
    const { data, error } = await fetchAllRows(query, { label: '[test]' });
    expect(error).toBeNull();
    expect(data).toHaveLength(1234);
  });

  it('conjunto vacío: [] sin error', async () => {
    const { query, ranges } = source(0);
    const { data, error } = await fetchAllRows(query, { label: '[test]' });
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(ranges).toHaveLength(1);
  });

  it('pide una consulta nueva por página (los builders son mutables)', async () => {
    const { query } = source(1500);
    const factory = vi.fn(query);
    await fetchAllRows(factory, { label: '[test]' });
    expect(factory).toHaveBeenCalledTimes(3);
  });
});

describe('fetchAllRows: falla ruidosa, nunca parcial', () => {
  it('error en una página INTERMEDIA: devuelve error y data null, no las filas ya leídas', async () => {
    const { query, ranges } = source(3000, { failAtFrom: 1000 });
    const result = await fetchAllRows(query, { label: '[CalendarioPage] roster:' });

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('lectura incompleta');
    expect(result.error?.message).toContain('timeout de la base');
    expect(ranges).toHaveLength(2); // no sigue después de la falla
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[CalendarioPage] roster:'));
  });

  it('error en la primera página: se propaga', async () => {
    const { query } = source(10, { failAtFrom: 0 });
    const result = await fetchAllRows(query, { label: '[test]' });
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it('tope de seguridad superado: error reportado (no un recorte)', async () => {
    const { query } = source(2500);
    const result = await fetchAllRows(query, { label: '[test] grande:', maxRows: 2000 });

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('tope de seguridad de 2000 filas');
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[test] grande:'));
  });

  it('justo en el tope de seguridad: es válido', async () => {
    const { query } = source(2000);
    const { data } = await fetchAllRows(query, { label: '[test]', maxRows: 2000 });
    expect(data).toHaveLength(2000);
  });

  it('consulta que ignora el rango (siempre la misma página): corta por el tope, no gira para siempre', async () => {
    const page = Array.from({ length: 1000 }, (_, n) => ({ n }));
    const query = () => ({ range: () => Promise.resolve({ data: page, error: null }) });
    const result = await fetchAllRows(query, { label: '[test]', maxRows: 5000 });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('tope de seguridad');
  });
});
