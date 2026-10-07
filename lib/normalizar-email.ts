// FB-PI-11-C — Clave normalizada de email: espejo EXACTO del índice
// profiles_email_normalizado_unique (migración 0022), lower(btrim(email)).
//
// Una sola función para todo lo que tiene que coincidir con ese índice: el
// matcheo de emails del import del calendario y el chequeo de duplicados del
// alta de usuarios (FB-PI-AUD-11, hallazgo 5). Si el índice normaliza de una
// forma y la app de otra, se desincronizan: el import rechaza emails válidos
// como inexistentes, o el alta deja pasar un duplicado hasta el error crudo
// de base.
//
// btrim(text) sin segundo argumento recorta SOLO espacios (' '), no tabs ni
// saltos de línea — por eso no es String.prototype.trim(), que recorta todo
// el whitespace. El paridad contra Postgres real la verifica
// tests/integration/calendario-import.test.ts (describe "normalización").
//
// lower(): para emails ASCII (los del portal) coincide con toLowerCase().
export function normalizarEmail(email: string): string {
  return email.replace(/^ +| +$/g, '').toLowerCase();
}
