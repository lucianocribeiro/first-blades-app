# FB-PI-05-C — Cierre de FB-PI-05: triage de auditoría y merge del PR #51

- **ID:** FB-PI-05-C
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-05-C.md`
- **Continúa:** `FB-PI-05` / `FB-PI-05-B` (PR #51, branch `fix/fb-pi-05-truncamiento-postgrest`)
- **Origen:** Log de Airtable `recLCRDdKcStPVWwS` (Bug, Alta, BLOCKER)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Triage de `FB-PI-AUD-05`

Codex devolvió **un solo hallazgo, severidad Menor**: falta el borde exacto de 1001 filas en `tests/unit/fetch-all.test.ts` y `tests/integration/lecturas-completas.test.ts`.

**Resolución: se arregla en este PR, no se difiere.** Es un test y el caso es real: con 1001 filas la segunda página trae exactamente una fila, que es el borde donde se cuela un off-by-one. Si el conjunto grande que ya se testea es bastante mayor que 1000, ese caso concreto no queda cubierto. Mandar esto al Log sería burocracia.

Nada más del informe requiere acción. Sin re-auditoría (§1.1, nivel de rigor de features).

---

## Paso 1 — Test del borde 1001

- Agregá el caso de **exactamente 1001 filas**, verificando que la segunda página devuelve esa única fila y que el bucle cierra bien.
- Aplicalo donde Codex lo marcó: unitario del helper e integración.
- Mismo criterio que el resto: que **falle** si se saca la paginación.

---

## Paso 2 — Versionar el informe de auditoría

Guardá el informe de `FB-PI-AUD-05` **verbatim** en `docs/audits/FB-PI-AUD-05.md`, **dentro de un bloque de código**, sin editar ni resumir (§1.1). Agregá debajo, fuera del bloque y marcado como nota del Developer, el triage: hallazgo único de severidad Menor, resuelto en este mismo PR, sin re-auditoría.

Guardá también `docs/prompts/FB-PI-AUD-05.md` y este prompt en `docs/prompts/FB-PI-05-C.md`.

---

## Paso 3 — Estado y autorización ⛔

Entregá, antes de pedir el merge:

- **CI por job sobre la cabeza del branch** (los tres jobs). Todavía no reportaste el resultado de la corrida de #51: hace falta para autorizar.
- Branch, commits fuera de `main`, conflictos con `main` si los hubiera.

**Si algún job está en rojo, frená y reportá. No mergees.**

---

## Paso 4 — Merge (solo con autorización explícita de Luciano)

- **Merge commit. Nunca squash.** Sin rebase del branch sobre `main`, sin reescribir historia.
- Después del merge, reportá: hash del merge commit, CI sobre `main`, y estado del deploy de Vercel a producción.
- **Reportá cualquier acción que toque producción** (§2.3).

---

## Paso 5 — Rebase de `FB-PI-04` (después del merge de #51)

Como se acordó: rebaseá `feat/fb-pi-04-export-calendario` (PR #52, draft) sobre el nuevo `main` y **reemplazá su paginación propia por `fetchAllRows`**. El export tiene que consumir el helper, no convivir con una implementación paralela.

Los dos branches tocan `lib/copy` y `calendario/page.tsx`: el conflicto se resuelve en el rebase de `FB-PI-04`.

Cuando esté rebaseado y con CI verde, pasá el PR #52 de draft a listo y avisá. Ahí sigue `FB-PI-AUD-04`.

---

## Fuera de alcance

- Paginación en la UI de Aprobadas (Log `recjXWDGc8OdlWGWj`).
- El import de calendario.
- Las dos purgas pendientes (Santiago y calendario de prueba).
- Los desfasajes de documentación de la constitución (`rec2CQcbv5jKODcAF`).

---

## Definición de Done

- [ ] Test de 1001 filas agregado, unitario e integración.
- [ ] `docs/audits/FB-PI-AUD-05.md` commiteado verbatim, en bloque de código, con la nota de triage.
- [ ] CI verde en los tres jobs, reportado por job.
- [ ] Merge autorizado por Luciano y ejecutado con merge commit.
- [ ] Deploy a producción reportado.
- [ ] `FB-PI-04` rebaseado sobre el nuevo main, consumiendo `fetchAllRows`, PR #52 fuera de draft.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-05-C.md`.

**El merge lo autoriza Luciano, sin excepción.**
