# FB-PI-02 — Cierre de FB-PI-01: informe versionado + resincronización del contador

- **ID:** FB-PI-02
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-02.md`
- **Continúa:** `FB-PI-01` (PR #50, branch `feat/fb-pi-01-campanita-aprobaciones`, commit `0719d63`)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Contexto

`FB-PI-01` pasó CI en los tres jobs y la auditoría de Codex (`FB-PI-AUD-01`) volvió **sin hallazgos**. Falta cerrar dos cosas antes de pedir la autorización de merge a Luciano.

La segunda es el punto 3 que vos mismo levantaste en el reporte: en navegación del lado del cliente el layout no se vuelve a renderizar, así que el badge puede quedar desactualizado. Decisión de Luciano: **opción (b)** — resincronizar el contador cuando el admin entra a `/aprobaciones`.

El razonamiento, para que el diseño lo respete: el único lugar donde el desfasaje se ve y molesta es con el admin parado en la bandeja, con el badge marcando 3 y la tabla mostrando 4 filas al lado. Eso incumple el criterio de aceptación principal de `FB-PI-01`. En cualquier otra pantalla un número levemente viejo es inofensivo y es exactamente el trade-off que aceptamos al elegir "al cargar/navegar" sobre realtime. Por eso **no** se resincroniza en cada navegación del admin: rechazamos realtime por costo, no tiene sentido pagar ahora una consulta extra por página.

Todo va sobre el **mismo PR #50**. No abras branch nuevo.

---

## Paso 1 — Versionar el informe de auditoría

Guardá el informe de `FB-PI-AUD-01` **verbatim** en `docs/audits/FB-PI-AUD-01.md`, **dentro de un bloque de código**, para que el Markdown no se aplane (constitución §1.1). No lo edites, no lo resumas, no lo reformatees: va tal cual lo devolvió Codex, incluida la sección de verificación.

Agregá debajo del bloque, **fuera** del código y claramente marcado como nota del Developer, una línea al respecto de que Codex no pudo correr el e2e localmente por falta de las variables `E2E_*`, y que ese job corrió **verde en CI** (30 pasaron, 1 flaky ajeno a esta historia, en `gestion-usuarios.spec.ts`). CI es la compuerta autoritativa.

Commiteá esto como commit propio, separado del código del Paso 3.

---

## Paso 2 — Propuesta del mecanismo · ⛔ FRENÁ ACÁ

**No escribas código de esta parte todavía.** Proponé el mecanismo y esperá el OK.

Entregá, en el chat, **en una o dos líneas**: cómo pensás forzar que el contador del layout se recalcule cuando el admin entra a `/aprobaciones`, y por qué esa forma no dispara un ciclo de refresco.

Esa última parte no es retórica. Forzar el refresco de un layout desde una ruta que ese mismo layout envuelve es justo donde se cuela un loop de render: la página revalida el layout, el layout se vuelve a renderizar, la página se vuelve a montar. Quiero ver cómo lo evitás antes de que exista el código.

Incluí en la propuesta:

- Dónde vive el disparador (página, layout, action, otro) y qué API usa.
- Qué pasa si el admin ya está en `/aprobaciones` y aprueba una solicitud: el camino de revalidación que ya funciona hoy y el nuevo, ¿conviven sin pisarse ni duplicar consultas?
- Costo: cuántas consultas extra por entrada a la bandeja.

**Si la solución no sale trivial** — si te pide reestructurar el layout, meter un `useEffect` de sincronización, mantener el conteo en estado del cliente, o cualquier cosa que agregue superficie de bug desproporcionada al problema: **frená y decilo**. Se carga como entrada nueva del Log y se mergea `FB-PI-01` como está. Preferimos eso antes que forzar una solución rebuscada para un desfasaje que dura hasta la próxima navegación.

---

## Paso 3 — Implementación (solo con el OK del Paso 2)

Implementá lo aprobado, respetando todo lo que ya está en pie de `FB-PI-01`:

- `pendientesQuery()` en `lib/aprobaciones.ts` sigue siendo la **única** definición de "pendiente". No aparece un segundo camino de conteo.
- `createServerClient()`, nunca `createAdminClient()`.
- El `{ error }` de PostgREST se lee como valor (§2.5).
- Degradación suave: un fallo de lectura no tumba el layout ni la topbar.
- Admin-only: no se consulta nada para supervisor ni empleado.
- Sin badge con cero. Clases de Tailwind literales, sin composición en runtime.
- Copy es-AR desde `/lib/copy`.

---

## Paso 4 — Tests

- **e2e:** el admin está en otra pantalla, aparece una solicitud nueva, el admin navega a `/aprobaciones` **sin recargar**, y el número del badge coincide con las filas de la bandeja.
- Que el test **falle** si se saca la resincronización. Un test que pasa con y sin el fix no prueba nada.
- No rompas los 5 e2e de `campanita.spec.ts` ni el resto de la suite.
- Si tu test necesita mutar datos, mantené el patrón que ya usaste: correr en serie y devolver los registros a su estado original al final, contra la base efímera que levanta CI. **Nunca contra producción.**

---

## Fuera de alcance

- Realtime, suscripciones, polling.
- Resincronizar en cualquier ruta que no sea `/aprobaciones`.
- Centro de notificaciones general.
- El bug de `audit_log` tragado en `aprobaciones/actions.ts` (Log `recgttytHv9848xI8`).
- La corrección de la constitución §5 (Log `rec2CQcbv5jKODcAF`): va en un PR docs-only aparte, **no acá**.
- El flaky de `gestion-usuarios.spec.ts`.

---

## Cierre

- [ ] `docs/audits/FB-PI-AUD-01.md` commiteado, verbatim, en bloque de código.
- [ ] Mecanismo propuesto y aprobado antes de escribir el código.
- [ ] e2e que falla sin el fix y pasa con él.
- [ ] CI verde en los tres jobs.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-02.md`.
- [ ] Estado del repo entregado: branch, PR #50 con estado de CI por job, commits fuera de main.

**El merge lo autoriza Luciano, sin excepción.** No mergees por tu cuenta.
