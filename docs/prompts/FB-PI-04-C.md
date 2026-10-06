# FB-PI-04-C — Cierre de FB-PI-04: triage de auditoría y merge del PR #52

- **ID:** FB-PI-04-C
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-04-C.md`
- **Continúa:** `FB-PI-04` / `FB-PI-04-B` (PR #52, branch `feat/fb-pi-04-export-calendario` @ `0df5f62`)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Triage de `FB-PI-AUD-04`

Codex devolvió **un hallazgo, severidad Mayor**: `fetchCalendarioExportData` lee `profiles` sin `fetchAllRows()` ni `.range()`, así que con más de 1000 empleados y supervisores activos el export armaría filas solo para los primeros 1000, sin ninguna señal.

**Resolución: se arregla en este PR.**

El razonamiento, para que quede claro por qué no se difiere algo que en la práctica necesita más de 1000 empleados activos cuando hoy hay 25: la regla que acabamos de fijar en `FB-PI-05` es que **toda lectura que pueda superar las 1000 filas va por el helper**. Ésta puede. Aceptar una excepción a una regla con tres días de vida, en el mismo PR que fue rebaseado para consumir ese helper, es cómo la regla se vuelve opcional.

El resto del informe son confirmaciones, sin acción. Sin re-auditoría (§1.1, nivel de rigor de features).

---

## Paso 1 — Paginar la lectura de perfiles

- `fetchCalendarioExportData` lee `profiles` con `fetchAllRows()`.
- **Preservá exactamente los filtros actuales:** `status = 'activo'` y roles `empleado` / `supervisor`. Sin admins, sin inactivos. No ensanches el conjunto al convertir.
- **Orden total estable**, como en el resto de las lecturas paginadas. Paginar sin orden determinístico puede saltear o duplicar filas.
- Revisá si quedó **alguna otra lectura sin paginar** en el diff de este PR, no solo ésta. Si aparece otra, aplicá el mismo criterio y reportala.

---

## Paso 2 — Test

Agregá un test que verifique que **todos** los perfiles llegan al archivo cuando hay más de 1000.

**Reusá el cliente falso que ya construyó `FB-PI-05`** —el que corta en 1000 filas sin error, imitando a PostgREST— en vez de levantar mil perfiles reales. El test tiene que ponerse **rojo** si alguien saca el `fetchAllRows()` de esa lectura.

---

## Paso 3 — Versionar el informe de auditoría

Guardá el informe de `FB-PI-AUD-04` **verbatim** en `docs/audits/FB-PI-AUD-04.md`, **dentro de un bloque de código**, sin editar ni resumir (§1.1). Agregá debajo, fuera del bloque y marcado como nota del Developer:

- El triage: hallazgo único de severidad Mayor, resuelto en este mismo PR, sin re-auditoría.
- Que Codex no pudo correr los tests de integración localmente por falta de PostgreSQL, y que **ese job corrió verde en CI**. CI es la compuerta autoritativa.

Guardá también `docs/prompts/FB-PI-AUD-04.md` y este prompt en `docs/prompts/FB-PI-04-C.md`.

---

## Paso 4 — Estado y autorización ⛔

Antes de pedir el merge, entregá:

- **CI por job sobre la nueva cabeza del branch** (los tres jobs). La corrida sobre `0df5f62` no sirve como compuerta una vez que haya commits nuevos.
- Branch, commits fuera de `main`, conflictos con `main`.

**Si algún job está en rojo, frená y reportá. No mergees.**

---

## Paso 5 — Merge (solo con autorización explícita de Luciano)

- **Merge commit. Nunca squash.** Sin rebase sobre `main`, sin reescribir historia.
- Después del merge, reportá: hash del merge commit, CI sobre `main`, y estado del deploy de Vercel a producción.
- **Reportá cualquier acción que toque producción** (§2.3).

---

## Fuera de alcance

- Todo el import de calendario (va en su propio prompt, con migración).
- La verificación manual de los desplegables en Google Sheets: es de Luciano, no bloquea el merge.
- Las dos purgas pendientes (Santiago y calendario de prueba).
- Paginación en la UI de Aprobadas (`recjXWDGc8OdlWGWj`).
- Los desfasajes de documentación de la constitución (`rec2CQcbv5jKODcAF`).

---

## Definición de Done

- [ ] Lectura de `profiles` paginada con `fetchAllRows()`, filtros preservados y orden estable.
- [ ] Test de más de 1000 perfiles, con el cliente falso de `FB-PI-05`, que falla sin el fix.
- [ ] Otras lecturas sin paginar del diff revisadas y reportadas.
- [ ] `docs/audits/FB-PI-AUD-04.md` commiteado verbatim, en bloque de código, con la nota de triage.
- [ ] CI verde en los tres jobs sobre la nueva cabeza, reportado por job.
- [ ] Merge autorizado por Luciano y ejecutado con merge commit.
- [ ] Deploy a producción reportado.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-04-C.md`.

**El merge lo autoriza Luciano, sin excepción.**
