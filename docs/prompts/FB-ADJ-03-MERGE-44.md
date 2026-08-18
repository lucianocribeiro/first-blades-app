# FB-ADJ-03-MERGE-44 — Merge de la PR #44

- **ID:** FB-ADJ-03-MERGE-44
- **Tipo:** ajuste inter-fase
- **Destino:** Claude Code
- **PR:** #44 · rama `fb-adj-03-eliminar-ingreso-pendiente`
- **Autorización:** Luciano. **No ejecutes el merge sin ella.**

---

## Contexto

Cierra el ajuste `FB-ADJ-03`: eliminación del módulo "Ingreso" y del valor `pendiente` del enum. Auditoría `FB-ADJ-AUD-03`: **aprobado, sin hallazgos**.

El `db push` de la `0021` es **posterior** a este merge y va por su propio runbook.

## Paso 1 — Versionar el informe

**Antes del merge.** Creá `docs/audits/FB-ADJ-AUD-03.md` con el informe **verbatim** de Codex (Luciano te pasa el texto crudo, en bloque de código): cabecera de metadata (ID, PR #44, rama, fecha, veredicto "Aprobado") separada del cuerpo con `---`, y nota de cierre indicando que habilita el merge y el push.

Versioná también este prompt en `docs/prompts/FB-ADJ-03-MERGE-44.md`.

`commit → push` y **esperá CI en verde** antes de seguir.

## Paso 2 — Estado real del repo

Reportá antes de mergear, nunca lo asumas: ramas, PRs abiertos con su estado y CI, commits fuera de `main`, y **drift** (`merge-base` contra el HEAD de `origin/main`).

Recordá que **la PR #26** (`docs/fb-f4-09-prompt`) sigue abierta desde Fase 4. No la toques: solo reportá su estado.

## Paso 3 — Merge

Con la autorización de Luciano confirmada.

- **Merge commit. NUNCA squash.**
- Mensaje que identifique el ajuste, la migración `0021` y la auditoría.
- La rama no se borra.

## Paso 4 — Confirmar

- CI de `main` en verde, los 3 jobs.
- `main` local sincronizado.
- Que `0021` esté en `main` y que **producción siga en 0020**.

## Definition of Done

- [ ] `docs/audits/FB-ADJ-AUD-03.md` verbatim, versionado antes del merge.
- [ ] `docs/prompts/FB-ADJ-03-MERGE-44.md` versionado.
- [ ] Estado del repo reportado antes de mergear.
- [ ] Merge con merge commit, autorizado por Luciano.
- [ ] CI de `main` en verde después del merge.
- [ ] `db push` NO ejecutado. Confirmalo.
- [ ] Reporte: SHA del merge, estado de `main`, versión real de producción, PRs que queden abiertas.
