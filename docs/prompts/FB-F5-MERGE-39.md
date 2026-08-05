# FB-F5-MERGE-39 — Merge de la PR #39 (migración de Fase 5)

- **ID:** FB-F5-MERGE-39
- **Fase:** 5
- **Destino:** Claude Code
- **PR:** #39 · rama `fase-5/f5-02-migracion`
- **Autorización:** Luciano. **No ejecutes el merge sin ella.**
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1)

---

## Contexto

Cierra la migración `0020_fase5_procedimientos.sql`, auditada tres veces por Codex:

- `FB-F5-AUD-02` → LIMPIO CON OBSERVACIONES, 2 hallazgos → fix `FB-F5-03`
- `FB-F5-AUD-03` → CON HALLAZGOS BLOQUEANTES, 2 hallazgos → fix `FB-F5-04`
- `FB-F5-AUD-04` → **LIMPIO**, con el sí explícito para aplicar a producción

El `db push` es **posterior** a este merge y va por su propio runbook.

---

## Paso 1 — Versionar el informe de FB-F5-AUD-04

**Antes del merge, sin excepción.**

Creá `docs/audits/FB-F5-AUD-04.md` con el informe **verbatim** de Codex (Luciano te pasa el texto crudo, emitido dentro de un bloque de código). Mismo criterio que los dos anteriores: cabecera de metadata (ID, PR #39, rama, fecha, veredicto `LIMPIO`) separada del cuerpo con `---`, y nota de cierre indicando que habilita el merge y el push.

Si el texto llega aplanado, **frená y pedilo de nuevo.** No lo reconstruyas.

Versioná también este prompt en `docs/prompts/FB-F5-MERGE-39.md`.

`commit → push` sobre la misma rama y **esperá CI en verde** antes de seguir.

## Paso 2 — Estado real del repo

**Antes de mergear, reportá el estado real. Nunca lo asumas.**

- Ramas locales y remotas.
- PRs abiertos: número, estado, `mergeable`, CI.
- Commits fuera de `main`.
- Stacking entre ramas, si lo hay.
- **Drift:** `merge-base` de la rama contra el HEAD de `origin/main`. Si `main` avanzó desde que se abrió la PR, decilo antes de mergear.

Recordá que la PR de `FB-F5-01-INSPECT` puede seguir abierta. Si es así, reportalo: hay que definir el orden y no dejarla colgando.

## Paso 3 — Merge

Solo con la autorización de Luciano confirmada.

- **Merge commit. NUNCA squash.**
- Mensaje que identifique la pieza: la migración `0020`, la fase, y los IDs de las tres auditorías.
- `deleteBranchOnMerge: false` — la rama no se borra en el merge.

## Paso 4 — Confirmar

- CI de `main` en verde tras el merge, los 3 jobs.
- `main` local sincronizado con `origin/main`.
- Confirmá que `0020` está en `main` y que **producción sigue en 0019** (el merge no aplica nada a la base).

## Definition of Done

- [ ] `docs/audits/FB-F5-AUD-04.md` verbatim, versionado **antes** del merge.
- [ ] `docs/prompts/FB-F5-MERGE-39.md` versionado.
- [ ] Estado real del repo reportado antes de mergear.
- [ ] Merge ejecutado con merge commit, con autorización de Luciano.
- [ ] CI de `main` en verde después del merge.
- [ ] `db push` NO ejecutado. Confirmalo explícitamente.
- [ ] Reporte de cierre: SHA del merge commit, estado de `main`, migración en `main`, versión real de producción, y si quedó alguna PR abierta.

## Si algo se desvía

Si el pre-merge encuentra que falta versionar algo, que `main` tiene drift, o que la PR dejó de estar `CLEAN`, **frená y reportá**. El pre-merge ya frenó por esto en fases anteriores y funcionó: es la última red antes de que algo entre a `main`.
