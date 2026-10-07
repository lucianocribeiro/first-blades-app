# FB-PI-11-E — Test del tope de 366 días y preparación del `db push`

- **ID:** FB-PI-11-E
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11-E.md`
- **Continúa:** `FB-PI-AUD-11-B` (re-auditoría, 1 hallazgo Menor) · PR #56
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** 0022, **todavía sin aplicar**.

---

## Triage de la re-auditoría

Codex devolvió **un solo hallazgo, severidad Menor**: falta una prueba de integración del tope de 366 días en la RPC. La validación SQL existe (`v_hasta - v_desde + 1 > 366` con `22023`), pero el bloque DB-backed solo ejercita los límites de la ventana temporal, no el de la duración del rango. El único test del tope vive a nivel de app.

**Resolución: se agrega el test y después va el `db push`. Sin tercera re-auditoría.**

El razonamiento: agregar un test de integración **no toca la migración ni el código de la función**, así que no hay superficie nueva que auditar. La ceremonia de re-auditoría existe para cambios en lo que se va a aplicar a producción; acá el código ya está correcto y lo que faltaba era cubrirlo. Es el mismo criterio que aplicamos con el borde de 1001 filas en `FB-PI-05`.

Si al escribir el test descubrís que la validación **no** se comporta como dice el SQL, eso **sí** es un cambio de código y vuelve a auditoría. Avisá en ese caso.

---

## Paso 1 — El test

Agregá un test DB-backed que invoque `importar_calendario` con:

- Fechas **dentro** de la ventana temporal válida (entre `2020-01-01` y hoy + 2 años), para que no salte la otra validación y el test pruebe lo que dice probar.
- Un rango de **367 días** entre la fecha más temprana y la más tardía.

Y verifique:

- Que devuelve **`22023`**.
- Que **no se escribe ninguna fila**. El código de error solo no alcanza: lo que importa es que no haya efecto.
- Que **falla si se saca la validación SQL de 366 días**. Comprobalo volviendo la función a la versión sin esa validación y confirmando que el test se pone rojo.

Dejá también cubierto el **borde válido de 366 días exactos**, que debe pasar. Un test que solo prueba el lado que falla no distingue entre "valida bien" y "rechaza todo".

---

## Paso 2 — Versionar el informe

Guardá el informe de `FB-PI-AUD-11-B` **verbatim**, dentro de un bloque de código, en `docs/audits/FB-PI-AUD-11-B.md`. Sin editar ni resumir.

Debajo del bloque, fuera del código y marcado como nota del Developer: hallazgo único de severidad Menor, resuelto con un test en el mismo PR, **sin tercera re-auditoría** porque la corrección no toca la migración ni el código de la función.

Guardá también `docs/prompts/FB-PI-AUD-11-B.md` y este prompt.

**Antes de escribir el archivo, verificá si ya existe en disco sin commitear** y leelo. En este PR ya se perdió el contenido previo de un archivo de auditoría por sobrescribirlo sin leer.

---

## Paso 3 — Preparación del `db push` ⛔

Con CI verde en los tres jobs, entregá a Luciano el paquete completo para el push, sin ejecutarlo:

1. **Auditoría de esquema previa**, actualizada: incluí la reverificación de que **no hay emails duplicados** por mayúsculas o espacios en producción. La verificación anterior es de hace días y el índice único falla al crearse si aparece un caso.
2. **El runbook paso a paso**, con los comandos exactos que va a correr Luciano.
3. **Las queries de verificación de catálogo** post-push, listas para copiar: `owner`, `prosecdef`, `proconfig`, `proacl` de la función nueva, y la existencia del índice único.
4. Qué esperar de `migration list` (Local = Remote) y del regen de `types.ts --linked`.
5. **Qué hacer si el push falla a mitad**, en concreto: qué queda aplicado, qué no, y cómo se vuelve atrás.

**El `db push` lo corre Luciano.** No lo ejecutes vos bajo ninguna circunstancia.

---

## Fuera de alcance

- Las nueve funciones de producción con la guarda vulnerable a NULL (`recfamWK93drsaCiQ`): migración separada, después de cerrar el import.
- Los dos riesgos registrados sin acción (cancelación de ausencia, edición manual sin auditoría).
- Configuración de Gmail.
- **Cargar el historial de 3 meses:** lo hace Luciano desde la app, después del merge.

---

## Definición de Done

- [ ] Test DB-backed de 367 días: devuelve `22023`, no escribe filas, y se pone rojo si se saca la validación SQL.
- [ ] Borde válido de 366 días exactos cubierto.
- [ ] `docs/audits/FB-PI-AUD-11-B.md` commiteado verbatim, con la nota de triage.
- [ ] CI verde en los tres jobs, reportado por job.
- [ ] Paquete del runbook entregado, con la reverificación de duplicados de email incluida.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11-E.md`.

**El `db push` lo corre Luciano. El merge lo autoriza Luciano.**
