// FB-PI-05 — Lectura COMPLETA de un conjunto que puede superar el tope de
// filas de PostgREST.
//
// El problema: PostgREST corta cada respuesta en `max_rows` (1000 en
// supabase/config.toml y en Supabase hosted) y NO devuelve error. Una lectura
// sin paginar que pasa ese tope vuelve truncada y parece completa: la app
// dibuja celdas vacías que tienen asignación, calcula alertas sobre días
// faltantes o reenvía mails que ya mandó. Ver docs/audits/FB-PI-05-DIAG.md.
//
// Regla: toda lectura de una tabla que crezca con la nómina o con el tiempo
// pasa por acá. El helper:
//   - pagina con .range() hasta una página vacía (no corta por "página
//     incompleta": si el servidor tuviera un max_rows menor que pageSize,
//     eso volvería a truncar en silencio);
//   - lee el { error } de PostgREST como valor en CADA página (un try/catch
//     no lo captura, constitución §2.5);
//   - NUNCA devuelve un resultado parcial: ante cualquier falla devuelve
//     { data: null, error } y lo loguea con la etiqueta de la lectura;
//   - tiene un tope de seguridad (maxRows) contra bucles infinitos o
//     conjuntos inesperadamente enormes; si se alcanza, es un error
//     reportado, no un recorte.
//
// Requisito del llamador: la consulta debe tener un ORDEN TOTAL Y ESTABLE
// (terminar en una columna única, ej. .order('id')). Sin eso, Postgres no
// garantiza el orden entre páginas y se pueden repetir o saltear filas.
//
// Devuelve la misma forma que una respuesta de PostgREST ({ data, error }),
// para que el call site siga leyendo el error como valor.

export const FETCH_ALL_PAGE_SIZE = 1000;
export const FETCH_ALL_MAX_ROWS = 50_000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// La consulta ya armada (select + filtros + orden), SIN .range(): el helper
// le aplica el rango de cada página. Se pide una consulta nueva por página
// porque los builders de supabase-js son mutables.
export type PagedQueryFactory<T> = () => { range(from: number, to: number): PageResult<T> };

export type FetchAllOptions = {
  // Identifica la lectura en el log (ej. '[CalendarioPage] roster').
  label: string;
  pageSize?: number;
  maxRows?: number;
};

export type FetchAllResult<T> =
  | { data: T[]; error: null }
  | { data: null; error: { message: string } };

export async function fetchAllRows<T>(
  query: PagedQueryFactory<T>,
  { label, pageSize = FETCH_ALL_PAGE_SIZE, maxRows = FETCH_ALL_MAX_ROWS }: FetchAllOptions
): Promise<FetchAllResult<T>> {
  const rows: T[] = [];

  for (let from = 0; ; ) {
    const { data, error } = await query().range(from, from + pageSize - 1);

    if (error) {
      const message = `lectura incompleta: falló la página que empieza en la fila ${from} (${error.message})`;
      console.error(`${label} ${message}`);
      return { data: null, error: { message } };
    }

    const page = data ?? [];
    if (page.length === 0) break;

    rows.push(...page);
    from += page.length;

    if (rows.length > maxRows) {
      const message = `lectura incompleta: se superó el tope de seguridad de ${maxRows} filas`;
      console.error(`${label} ${message}`);
      return { data: null, error: { message } };
    }
  }

  return { data: rows, error: null };
}
