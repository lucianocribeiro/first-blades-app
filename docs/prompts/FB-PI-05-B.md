# FB-PI-05-B — Continuación del fix de truncamiento: alcance aprobado y orden de merge

- **ID:** FB-PI-05-B
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-05-B.md`
- **Continúa:** `FB-PI-05`, Paso 0 entregado y aprobado (`docs/audits/FB-PI-05-DIAG.md`, commit `27a34d7` en `fix/fb-pi-05-truncamiento-postgrest`)
- **Origen:** Log de Airtable `recLCRDdKcStPVWwS` (Bug, Alta, **BLOCKER**)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Paso 0: aprobado

El diagnóstico está aceptado tal como lo entregaste. Queda registrado en el Log, con el punto que cambia la urgencia:

**El primero en romperse no es el roster, son las alertas de franco.** Ventana de 66 días, 25 activos no-admin, hasta 1650 filas potenciales: truncan con unos 40 días de calendario completo. Es decir que **cargar el historial de 3 meses las rompe en el acto**, con alertas falsas o alertas reales que no se emiten, también por mail. Por eso este fix va antes que el import y antes de cargar nada.

El de `notification_log` tiene consecuencia visible para el cliente: si esa lectura trunca, se mandan **mails duplicados a los empleados**.

---

## Definición 1 — Alcance: los 9 casos

**Entran los 9**, no solo los 5 de riesgo real:

- Roster del Calendario
- Alertas de franco (pantalla + cron de mails)
- Lecturas de idempotencia de `notification_log`
- Documentos con vencimiento (Equipo + cron)
- **Bandeja de Aprobadas**

El criterio: dejar una truncación conocida sin arreglar es exactamente el error silencioso que este trabajo viene a eliminar. No se deja ninguno para después.

---

## Definición 2 — Aprobadas: helper ahora, UI después

Aplicale el helper **ya**, sin tocar la UI.

Una lista larga que renderiza lento es un problema de experiencia. Una lista que oculta aprobaciones sin avisar es un problema de datos. Primero que no mienta; después que sea cómoda.

**La paginación en la UI de Aprobadas queda fuera de este PR**, como item propio del Log. Si al aplicar el helper ves que el volumen actual ya hace lenta la pantalla, decilo y lo cargamos con prioridad; no lo resuelvas acá.

---

## Definición 3 — Push y PR

**El push y la apertura del PR los hace Claude Code, siempre.** Es la regla de trabajo del proyecto, no una decisión que se consulta caso por caso.

Hoy eso está bloqueado por el permiso de la sesión. **Resolvelo de tu lado** y, si no podés, decí exactamente qué permiso falta y cómo se habilita. No vuelvas a devolver el push como tarea manual de Luciano.

Hay dos branches en local sin pushear (`fix/fb-pi-05-truncamiento-postgrest` y `feat/fb-pi-04-export-calendario`) y ningún PR abierto, así que no corrió CI de integración ni e2e sobre ninguno de los dos. Eso se destraba acá.

---

## Definición 4 — Orden de merge

Tu propuesta, aprobada:

1. **`FB-PI-05` se mergea primero.**
2. **`FB-PI-04` se rebasea sobre el nuevo `main`**, reemplazando su paginación propia por el helper compartido.

El export tiene que **consumir** el helper, no convivir con una implementación paralela. Dos implementaciones de lo mismo es cómo una de las dos se queda vieja sin que nadie lo note.

Los dos branches tocan `lib/copy` y `calendario/page.tsx`: resolvé el conflicto en el rebase de `FB-PI-04`, no al revés.

---

## Recordatorios del fix (de `FB-PI-05`, siguen vigentes)

- Helper único y reutilizable, que pagina con `.range()` y **falla ruidosamente antes que devolver un resultado truncado**.
- Lee el `{ error }` de PostgREST **como valor** en cada página; un `try/catch` no lo captura (§2.5).
- Tope de seguridad contra bucles infinitos que, si se alcanza, **se reporta**, no se esconde.
- `createServerClient()`, nunca `createAdminClient()`.
- Contrato return-based en Server Actions. Copy es-AR desde `/lib/copy`.
- **Test con más de 1000 filas que se ponga rojo si alguien saca la paginación.** Sin eso, el fix se pierde en el próximo refactor.
- No rompas la suite existente (31 e2e, tercer job de CI).

---

## Fuera de alcance

- Paginación en la UI de Aprobadas (item aparte del Log).
- El import de calendario.
- Las dos purgas pendientes (Santiago y calendario de prueba).
- Los desfasajes de documentación de la constitución (`rec2CQcbv5jKODcAF`).

---

## Definición de Done

- [ ] Helper compartido construido y aplicado a los 9 casos.
- [ ] Test con más de 1000 filas que falla sin el fix.
- [ ] **Branch pusheado y PR abierto por Claude Code**, con CI por job reportado.
- [ ] CI verde en los tres jobs.
- [ ] `FB-PI-04` rebaseado sobre el nuevo main después del merge, consumiendo el helper.
- [ ] Sin migración. Copy es-AR. Sin secretos.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-05-B.md`.

**El merge lo autoriza Luciano, sin excepción.**
