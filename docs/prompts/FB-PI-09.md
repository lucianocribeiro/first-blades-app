# FB-PI-09 — Merge de los PRs de registro de las purgas (#53 y #54)

- **ID:** FB-PI-09
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-09.md`
- **Cierra el registro de:** `FB-PI-06` (purga de `santiago@agenciakairos.net`) y `FB-PI-07` (purga del calendario de prueba)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración / `db push`:** ninguno. Ambos PRs son **doc-only**, sin cambios de código.

---

## Autorización

**Luciano autoriza el merge de los PRs #53 y #54.** Es la autorización explícita que pide §1.1, que aplica también a los PRs doc-only y a los de archivos generados.

Alcance: **únicamente #53 y #54**. Ningún otro PR abierto del repo, en particular el **#26 de Fase 4**, que sigue abierto y **no se toca**.

---

## Por qué importa cerrarlos

Estos dos PRs son el registro de **dos operaciones destructivas e irreversibles contra producción**. Mientras sigan abiertos, lo único que documenta qué se borró, en qué orden y con qué verificación es el chat. Eso no es un registro.

---

## Paso 1 — Verificación previa ⛔

Antes de mergear, reportá para **cada uno** de los dos PRs:

1. **Estado de CI por job.** Aunque sean doc-only, la compuerta es CI sobre el commit que se mergea.
2. **Conflictos con `main`.** Tené en cuenta que `main` avanzó con los merges de #51 y #52; si alguno de estos branches salió de un `main` anterior, puede haber divergencia.
3. Commits fuera de `main` en cada branch.
4. **Que el diff sea efectivamente doc-only.** Si alguno toca código, frená y reportá: dejaría de ser lo que estoy autorizando.

**Si algún job está en rojo, o si aparece cualquier cambio de código, frená y reportá. No mergees.**

---

## Paso 2 — Merge

- **Merge commit. Nunca squash.** Sin rebase sobre `main`, sin reescribir historia.
- Mergeá **#53 primero** (purga de Santiago) y después **#54** (purga del calendario), que es el orden cronológico de las operaciones. Si el merge de #53 deja a #54 con conflicto, resolvelo en #54, no al revés.

---

## Paso 3 — Verificación posterior

Reportá:

- Hash del merge commit de cada uno.
- Estado de CI sobre `main` después de ambos merges.
- Estado del deploy de Vercel.
- **Que `main` contenga los cuatro informes:** `FB-PI-06-PREFLIGHT.md`, el registro de ejecución de esa purga, `FB-PI-07-PREFLIGHT.md` y el registro de ejecución de la segunda.
- **Reportá cualquier acción que toque producción** (§2.3). Estos PRs no deberían tocar nada, pero el deploy automático corre igual.

---

## Fuera de alcance

- El PR #26 de Fase 4.
- El diagnóstico de los crons (`FB-PI-08`), que sigue después de esto.
- El import de calendario y la carga del historial.
- Borrar los snapshots de los backups: lo hace Luciano una vez validadas las purgas en la app.

---

## Definición de Done

- [ ] CI y diff verificados en ambos PRs antes de mergear.
- [ ] #53 y #54 mergeados con merge commit, en ese orden.
- [ ] Hashes reportados y CI verde sobre `main`.
- [ ] Los cuatro informes presentes en `main`.
- [ ] PR #26 sin tocar.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-09.md`.
