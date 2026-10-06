# FB-PI-04-B — Ajustes del export antes de la auditoría (PR #52)

- **ID:** FB-PI-04-B
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-04-B.md`
- **Continúa:** `FB-PI-04` (PR #52, branch `feat/fb-pi-04-export-calendario`, rebaseado sobre main @ `50f131f`)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Por qué ahora

Quedaron dos decisiones de producto sin responder cuando apareció el blocker de truncamiento. **Van antes de la auditoría**: si se cambian después de que Codex audite, hay que auditar de nuevo.

Son dos cambios chicos sobre un PR que ya está verde en los tres jobs.

---

## Ajuste 1 — Alcance de empleados: confirmado como está

**Los admins NO salen en el export.** El alcance se mantiene: empleados y supervisores activos, igual que el roster del admin. Decisión de Luciano.

No hay cambio de código acá. Lo que sí hay que hacer es **dejarlo documentado como decisión consciente**, no como un detalle de implementación:

- En el PRD (`docs/prd-calendario-export-import.md`), en la sección de alcance del export.
- Con la consecuencia explícita: un admin **puede** tener días de calendario propios, porque una ausencia o pasaje que se envía a sí mismo se auto-aprueba y escribe su calendario (§7, `FB-ADJ-01`). Esos días **no salen en el export ni se pueden corregir por Excel**; se gestionan desde la app.

Si en el código hay un comentario o un nombre de función que sugiera "todos los activos", corregilo para que diga lo que realmente hace.

---

## Ajuste 2 — Unificar la etiqueta de `periodo_fuera_trabajo`

Hoy hay dos etiquetas para el mismo estado: el Excel dice **"Período fuera del trabajo"** y la grilla de la app dice **"Fuera del trabajo"**.

**Se unifica a "Fuera del trabajo"**, que es lo que el admin ya ve todos los días en pantalla. Va a elegir del desplegable mirando la app; dos nombres para la misma cosa confunden.

- Cambiá la etiqueta en el mapeo etiqueta↔enum, en el desplegable del Excel y en la hoja de Referencia.
- **Una sola fuente**: la etiqueta sale de `/lib/copy` y el mapeo la consume. Si hoy está escrita en dos lugares, unificala. Dos literales para el mismo estado es exactamente el problema que estamos cerrando.
- Verificá que no quede ninguna otra etiqueta divergente entre el Excel y la app para los otros tres estados ni para los motivos. Si encontrás alguna, decilo.
- Actualizá el PRD.

---

## Verificación

- Los tests que cubren el mapeo tienen que seguir pasando y **fallar si alguien vuelve a divergir las etiquetas**. Si hoy el test no detectaría eso, agregalo.
- CI verde en los tres jobs sobre la nueva cabeza. Reportá por job.
- No rompas los 35 e2e (31 existentes + 4 del export).

---

## Fuera de alcance

- La verificación en Google Sheets: es prueba manual de Luciano, no bloquea el merge ni la auditoría. Los pasos ya están en `docs/audits/FB-PI-04-INSPECT.md` §9.
- Selector individual de empleados.
- Todo el import (va en su propio prompt).
- Las dos purgas pendientes.

---

## Para seguir

Con CI verde sobre la nueva cabeza, avisá y sigue `FB-PI-AUD-04` con Codex. **El merge lo autoriza Luciano, sin excepción.**

---

## Definición de Done

- [ ] Alcance de empleados documentado en el PRD como decisión consciente, con la consecuencia sobre los días de calendario de un admin.
- [ ] Etiqueta unificada a "Fuera del trabajo" en mapeo, desplegable y hoja de Referencia, desde una sola fuente en `/lib/copy`.
- [ ] Revisadas las demás etiquetas de estados y motivos; divergencias reportadas.
- [ ] Test que falla si las etiquetas vuelven a divergir.
- [ ] CI verde en los tres jobs, reportado por job.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-04-B.md`.
