# FB-PI-11 — Import del calendario desde Excel (admin)

- **ID:** FB-PI-11
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11.md`
- **PRD:** `docs/prd-calendario-export-import.md` (ya en main)
- **Continúa:** `FB-PI-04` (export, mergeado en `da081a6`)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** **SÍ.** Ceremonia completa.

---

## Encuadre

Segundo y último PR del módulo. El export ya está en producción y define el formato; el import lo consume.

**Esto es distinto de todo lo que hicimos en esta tanda.** No es una lectura ni una pieza de interfaz: escribe miles de filas en el calendario de producción, de una sola vez, sobre una app en uso y sin staging. Una importación mal armada reescribe el calendario de todo el equipo sin forma de deshacerla.

Por eso: **migración con ceremonia completa** (§1.1 y §2.3), auditoría de esquema antes del push, runbook gateado por Luciano, verificación de catálogo después, regen de tipos.

Estado actual de la base: `rotation_assignments` y `ausencia_requests` están **vacías** tras las purgas `FB-PI-06` y `FB-PI-07`. Hay 27 perfiles.

---

## Paso 0 — Inspección (obligatorio, con informe versionado) ⛔

**No escribas código ni SQL hasta terminar.** §1.1: toda inspección produce informe versionado explícito.

1. **El export, pieza por pieza:** columnas que genera, mapeo etiqueta↔enum y sus funciones inversas, alcance de empleados, formato de fecha. El import **reusa** todo eso; no escribas una segunda versión de nada.
2. **Esquema real de `rotation_assignments`** desde la base, no desde la constitución: columnas, tipos, `UNIQUE(user_id, fecha)`, constraints, enums y sus valores exactos. Ya detectamos desfasajes entre documentación y base.
3. **Patrón de las RPC existentes** (`resolver_ausencia_request`, `crear_aprobar_ausencia_admin`): molde de guardas, `search_path`, `REVOKE`, owner. El import sigue ese molde.
4. **`log_audit()`**: firma y cómo la invocan las funciones existentes.
5. **Cómo se suben archivos hoy** en la app (documentos), para reusar el patrón.
6. **Límites prácticos:** cuántas filas puede manejar una sola llamada de Server Action y una sola función Postgres en este stack, y si hace falta lotear. Un rango de 3 meses por 25 empleados son unas 2300 filas. **Si hace falta lotear, el lote debe seguir siendo todo-o-nada en conjunto**: una importación a medias es peor que una que falla.

**Entregable:** `docs/audits/FB-PI-11-INSPECT.md`, commiteado. **Frená acá y entregá el informe** antes de escribir la migración.

---

## Paso 1 — Migración

Función `SECURITY DEFINER` que recibe el lote y escribe `rotation_assignments` + `audit_log` **en una sola transacción**.

Molde obligatorio (§6.1):
- `SECURITY DEFINER` con `search_path` fijo explícito.
- **Guardas internas** como control principal: admin verificado contra `auth.uid()`, **NULL tratado como no-admin**, nunca desde un parámetro.
- `EXECUTE` solo a `authenticated`, con **`REVOKE` explícito de `anon` y de `PUBLIC`** (Supabase re-otorga a `anon` por default).
- Owner = rol de administración, verificable por catálogo post-push.
- Escribe auditoría con `PERFORM public.log_audit(...)`, nunca por `INSERT` directo.

**Delta-only:** inspeccioná el esquema real primero y escribí solo el delta. No asumas que la branch matchea producción.

**Drift detector:** actualizá `migration.test.ts` intencionalmente. Si agregás o modificás algún enum, necesita su propio test de valores exactos.

### `audit_log` — modelo híbrido (decidido, no re-abrir)

- **Una entrada de resumen por importación:** quién, cuándo, rango de fechas, filas creadas, modificadas y borradas.
- **Más una entrada por-día solo** para los días que pisaron una solicitud aprobada.

Es una excepción consciente a la convención por-día de §6.1, acotada a la importación masiva. Toda otra escritura de calendario mantiene la convención. **Al cerrar el módulo hay que registrar esta excepción en la constitución.**

---

## Paso 2 — Parseo y validación

Server-side, siempre. **El desplegable del Excel no es un control:** cualquiera puede pegar texto encima y Excel lo acepta.

Validaciones:
- Email existe en `profiles`. Si no existe → **error**. El import **nunca crea empleados**.
- Fecha válida y dentro de un rango razonable.
- Estado dentro del enum, vía el mapeo compartido.
- Motivo obligatorio si el estado es "Fuera del trabajo"; vacío en los demás casos.
- `motivo_otros` obligatorio si el motivo es "Otros".

---

## Paso 3 — Previsualización obligatoria

**No se puede saltear.** Nada se escribe antes de que el admin confirme.

Muestra:
- Filas a crear, a modificar y sin cambios.
- **Días que hoy vienen de una solicitud aprobada y que la importación va a pisar**, listados uno por uno con empleado y fecha. Decisión tomada: se pisan. Pero el admin los ve antes.
- Errores de validación con número de fila y motivo. **Con errores, la confirmación queda bloqueada.**
- **Impacto en el saldo de días de trámite** por empleado, y si excede el tope de 3 del año calendario. El import los acepta; el saldo se deriva del calendario, así que importarlos lo consume retroactivamente.
- **Cuántos días se van a borrar.** Celda de estado vacía = **borrar ese día**, no "dejarlo como está". Tiene que estar dicho con todas las letras en la pantalla, no solo en el código.

---

## Paso 4 — Escritura

- **Upsert por `(email, fecha)`**, que resuelve al `UNIQUE(user_id, fecha)`.
- `es_estimado = false` para todo día pasado.
- El import **no toca** `ausencia_requests` ni `pasaje_requests`, ni siquiera al pisar un día que una de ellas generó.
- `createServerClient()`, **nunca** `createAdminClient()`: `service_role` no tiene `sub` en el JWT y la guarda `auth.uid()` abortaría siempre.
- Contrato return-based (§2.5). El `{ error }` de PostgREST se lee como valor.
- Solo admin, verificado server-side; el guard corta por `redirect()`, no por `{ ok }`.
- Copy es-AR desde `/lib/copy`.
- Cualquier lectura que pueda superar 1000 filas usa `fetchAllRows`.

---

## Paso 5 — Tests

- **Ida y vuelta: exportar y reimportar sin cambios deja la base igual, cero diferencias.** Es el test que más valor tiene de todo este trabajo.
- Atomicidad: si falla una fila, no queda nada escrito.
- Cada validación rechaza lo que debe y la confirmación queda bloqueada.
- Celda vacía borra el día.
- Pisar un día de solicitud aprobada: se pisa, aparece en la previsualización, y la solicitud **no** se modifica.
- `audit_log`: una entrada de resumen, más las por-día solo de los días pisados.
- Límite de rol para los 3 roles.
- Volumen realista: unas 2300 filas.
- e2e sin romper los 35 existentes.

---

## Paso 6 — `db push` ⛔

Por el **runbook gateado** (§2.3), nunca por tu cuenta:

1. Auditoría de esquema **antes** del push.
2. Push, que **lo corre Luciano**.
3. **Verificación de catálogo** post-push: `owner`, `prosecdef`, `proconfig`, `proacl`.
4. `migration list` Local = Remote.
5. **Regen de `types.ts --linked`, siempre**, aunque el diff sea de infraestructura.

**Reportá toda acción que toque producción.**

---

## Fuera de alcance

- Export de otras entidades, import de perfiles, CSV.
- Paginación en la UI de Aprobadas (`recjXWDGc8OdlWGWj`).
- Configuración de Gmail.
- **Cargar el historial de 3 meses.** Eso lo hace Luciano desde la app, después del merge.

---

## Definición de Done

- [ ] `docs/audits/FB-PI-11-INSPECT.md` commiteado antes de escribir la migración.
- [ ] Migración con el molde de §6.1 completo; drift detector actualizado.
- [ ] Previsualización obligatoria, imposible de saltear, con los cinco bloques del Paso 3.
- [ ] Escritura atómica; nada a medias.
- [ ] Test de ida y vuelta con cero diferencias.
- [ ] Test de límite de rol para los 3 roles.
- [ ] CI verde en los tres jobs.
- [ ] Migración aplicada por el runbook gateado, con verificación de catálogo y regen de tipos.
- [ ] Excepción del `audit_log` registrada para llevar a la constitución.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11.md`.

**El merge lo autoriza Luciano, sin excepción. El `db push` lo corre Luciano.**
