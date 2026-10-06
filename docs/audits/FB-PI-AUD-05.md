```text
# FB-PI-AUD-05 — Auditoría del diff de FB-PI-05 (PR #51)

- **Fecha:** 2026-10-06
- **Rama auditada:** `fix/fb-pi-05-truncamiento-postgrest`
- **Base:** `main` @ `7c23982`
- **HEAD auditado:** `b0c2f4c`
- **Referencias:** `docs/constitucion.md` v0.8 + `docs/prompts/FB-PI-05.md` + `docs/prompts/FB-PI-05-B.md` + `docs/audits/FB-PI-05-DIAG.md`

## Resultado

1 hallazgo menor: falta el caso exacto de 1001 filas exigido por el foco de tests. No hay hallazgos bloqueantes ni mayores.

HALLAZGO 1 — Falta el borde exacto de 1001 filas
Severidad: Menor
Archivo:tests/unit/fetch-all.test.ts:56-67; tests/integration/lecturas-completas.test.ts:33-42
Qué: La suite prueba exactamente 1000 filas y conjuntos mayores (1234, 1464, 2500, 1100 y 1200), además de una página intermedia fallida, pero no prueba un conjunto de exactamente 1001 filas. Por lo tanto, queda sin una aserción explícita el salto mínimo que obliga a pedir una segunda página y luego terminar correctamente.
Por qué: Incumple el foco de auditoría 13 de FB-PI-AUD-05: los tests deben cubrir exactamente 1000, 1001 y una página intermedia que falla. La brecha no demuestra un fallo del helper ni deja una lectura parcial conocida, pero permite perder el caso mínimo de paginación sin una regresión localizada.
Sugerencia: Agregar un caso explícito de exactamente 1001 filas contra el simulador de PostgREST silencioso, verificando que devuelve las 1001 y que realiza la página adicional necesaria.

## Verificación

- `npm run typecheck` — OK.
- `npm test -- tests/unit/fetch-all.test.ts tests/unit/lecturas-completas.test.ts tests/unit/calendario-server-boundary.test.ts` — OK, 3 archivos / 37 tests.
- `npm test` — OK, 63 archivos / 827 tests.
- `npm run test:integration` — no verificable localmente: no hay PostgreSQL disponible; Vitest saltó 23 archivos / 420 tests, incluidos los 4 de `tests/integration/lecturas-completas.test.ts`.
- `npm run test:e2e -- --list` — OK; CI conserva el tercer job de Playwright y lista 31 tests.

## Confirmaciones de alcance

- Las 9 lecturas aprobadas usan `fetchAllRows`: roster y alertas de franco de Calendario; días recientes e idempotencia del cron de franco; documentos con vencimiento e idempotencia del cron de vencimientos; Aprobadas (ausencias y pasajes); y Equipo.
- Todas las lecturas paginadas tienen orden total: `user_id, fecha` sobre la clave única de `rotation_assignments`, o `id` como desempate/clave única en las demás tablas.
- El helper lee `{ error }` en cada página, descarta lo acumulado ante error, corta con página vacía, y devuelve error —no datos parciales— al superar el tope de seguridad.
- Se preservan filtros, `select`, scopes y clientes originales; no se usa `createAdminClient()` en las páginas, no se toca la UI de Aprobadas, no hay migración, secretos ni cambios de esquema.
```

---

> **Nota del Developer — triage (FB-PI-05-C):** un único hallazgo, severidad **Menor** (falta el borde exacto de 1001 filas). **Resuelto en este mismo PR (#51)**: se agregó el caso de 1001 filas en `tests/unit/fetch-all.test.ts` (verifica que la segunda página trae una sola fila y que el bucle cierra con la página vacía) y en `tests/integration/lecturas-completas.test.ts` (1001 avisos de franco contra PostgREST real, sin duplicados). Se verificó que el caso unitario **falla si se saca la paginación**. Sin re-auditoría (§1.1, nivel de rigor de features).
