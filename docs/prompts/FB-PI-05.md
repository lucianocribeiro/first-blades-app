# FB-PI-05 — BLOCKER: truncamiento silencioso a 1000 filas (tope PostgREST)

- **ID:** FB-PI-05
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-05.md`
- **Origen:** Log de Airtable `recLCRDdKcStPVWwS` (Bug, **Alta**, módulo Calendario, marcado BLOCKER por Luciano)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.
- **Prioridad:** máxima. Va **antes** del import de calendario y antes de cargar el historial de 3 meses.

---

## El problema

PostgREST corta las respuestas en 1000 filas por defecto y **no devuelve error**. La consulta vuelve truncada y la app no tiene forma de notarlo: recibe una respuesta que parece completa y la dibuja.

En la grilla del roster, las filas que quedaron afuera del corte **se ven como celdas vacías**, idénticas a un día sin asignar. El admin puede pintar encima de un día que cree libre y en realidad tenía asignación. Y el calendario alimenta las alertas de franco y el saldo de días de trámite, así que el error se propaga a las dos.

**Por qué es blocker:** pone un techo de cantidad de empleados a un portal de RRHH. El cliente tiene altas previstas. Y si se carga el historial antes del fix, una celda vacía pasa a ser indistinguible entre "no se cargó" y "el sistema no me lo muestra".

---

## Paso 0 — Diagnóstico (obligatorio, con informe versionado) ⛔

**No escribas el fix hasta terminar esto.** El dato que más importa no lo tenemos: **si el truncamiento ya está ocurriendo en producción hoy.**

Respondé con precisión:

1. **La forma real de la consulta del roster.** ¿Cuántos días pide exactamente? El cálculo de "~33 empleados" asume 31 días. **Si la grilla dibuja semanas completas (42 celdas), el umbral baja a unos 23 perfiles y con los 28 perfiles actuales ya estaría truncando.** Verificalo, no lo asumas.
2. **¿La consulta filtra por `status = 'activo'` o trae todos los perfiles?** Hay 28 perfiles y 27 activos; si no filtra, el umbral baja.
3. **¿Hay prefetch de meses adyacentes** o alguna lectura que amplíe el rango más allá de lo que se ve?
4. **El umbral exacto**, con la cuenta hecha sobre la consulta real.
5. **¿Está truncando hoy, sí o no?** Respuesta binaria y fundamentada.
6. **Barrido de toda la app:** listá **todas** las consultas que puedan devolver más de 1000 filas sin paginar. No solo el calendario. Mirá como mínimo listados de documentos, `audit_log`, bandeja de Aprobaciones con historial, Equipo, y cualquier `select` sin `.range()` ni `.limit()` sobre una tabla que crezca con la nómina o con el tiempo. Para cada una: cuántas filas podría devolver y en qué escenario se rompe.

**Entregable:** `docs/audits/FB-PI-05-DIAG.md`, commiteado.

**Si el Paso 0 muestra que ya está truncando en producción**, decilo en el primer renglón del informe y avisá antes de seguir: cambia la urgencia y Luciano tiene que saberlo de inmediato.

---

## Paso 1 — Helper compartido de lectura completa

No arregles la consulta del calendario a mano y sigas de largo. El problema de fondo es que **cualquier consulta futura puede volver a caer en esto sin que nadie se dé cuenta**, porque falla en silencio.

Construí un helper único y reutilizable que lea en páginas hasta traer todo el conjunto, y que sea el camino estándar para cualquier lectura que pueda superar las 1000 filas.

Requisitos del helper:

- Pagina con `.range()` hasta agotar el conjunto.
- **Lee el `{ error }` de PostgREST como valor** en cada página; un `try/catch` no lo captura (§2.5).
- **Nunca devuelve un resultado truncado en silencio.** Si no puede completar la lectura, falla de forma ruidosa y registrable. Un error visible es infinitamente mejor que datos falsos.
- Tope de seguridad configurable para no entrar en un bucle infinito ante un conjunto inesperadamente enorme, y si lo alcanza, **lo reporta**, no lo esconde.

Si `FB-PI-04` ya construyó paginación para el export, **esta es la misma necesidad**: extraé esa lógica al helper compartido y que el export lo consuma, en vez de tener dos implementaciones.

---

## Paso 2 — Aplicar el fix

- La lectura del roster del Calendario pasa a usar el helper.
- Aplicalo también a **todas** las consultas que el Paso 0 haya marcado como vulnerables.
- Si alguna de ellas requiere un cambio de arquitectura mayor (paginación en la UI, no solo en la lectura), **no la fuerces acá**: reportala y la cargamos como item propio del Log. Este PR cierra el calendario y lo que sea de riesgo equivalente.
- `createServerClient()`, nunca `createAdminClient()`.
- Contrato return-based en las Server Actions (§2.5). Copy es-AR desde `/lib/copy`.

---

## Paso 3 — Tests

- **Test que falla sin el fix:** generá un conjunto de más de 1000 filas y verificá que la lectura devuelve **todas**. Si alguien saca la paginación, este test tiene que ponerse rojo.
- Test del helper: el conteo devuelto coincide con el real; el error de una página intermedia se propaga y no se traga.
- Test de que el roster muestra correctamente un mes con una cantidad de empleados por encima del umbral.
- No rompas la suite existente (31 e2e, tercer job de CI).

---

## Coordinación con `FB-PI-04`

El branch `feat/fb-pi-04-export-calendario` tiene 2 commits en local **sin pushear**. Este fix sale de `main`, en branch propio.

Decí explícitamente si prevés conflicto entre los dos, sobre todo si el export ya tiene su propia paginación que acá se extrae a un helper compartido. Si lo hay, proponé el orden de merge; no lo resuelvas por tu cuenta.

---

## Fuera de alcance

- El import de calendario.
- Las dos purgas pendientes (Santiago y calendario de prueba).
- Los desfasajes de documentación de la constitución (`rec2CQcbv5jKODcAF`).
- Rediseño de la grilla del roster.

---

## Definición de Done

- [ ] `docs/audits/FB-PI-05-DIAG.md` commiteado, con respuesta binaria a "¿está truncando hoy?".
- [ ] Helper compartido de lectura paginada, que falla ruidosamente antes que devolver datos incompletos.
- [ ] Calendario y todas las consultas vulnerables identificadas, usando el helper.
- [ ] Test con más de 1000 filas que falla si se saca la paginación.
- [ ] CI verde en los tres jobs.
- [ ] Sin migración. Copy es-AR. Sin secretos.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-05.md`.

**El merge lo autoriza Luciano, sin excepción.** Dada la prioridad, entregá el informe del Paso 0 apenas esté, sin esperar a tener el fix.
