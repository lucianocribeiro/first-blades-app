# FB-PI-11-B — Decisiones resueltas y construcción de la migración 0022

- **ID:** FB-PI-11-B
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11-B.md`
- **Continúa:** `FB-PI-11`, Paso 0 entregado (`docs/audits/FB-PI-11-INSPECT.md`)
- **PRD:** `docs/prd-calendario-export-import.md`
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** **0022.** Ceremonia completa.

---

## Paso 0: aprobado

La inspección está aceptada. Tres hallazgos que quedan incorporados como restricciones:

- **No hace falta lotear.** 3 meses × 25 empleados pesan unos 65 KB; un año, 216 KB. Entra en el límite de 1 MB de la Server Action, y la escritura va de una sola vez sobre todo el lote, no fila por fila. Una llamada es una transacción.
- **La base no impide un motivo con un estado que no sea "Fuera del trabajo".** Esa regla la valida la función nueva.
- **No hay vínculo entre un día del calendario y la solicitud que lo generó.** Se deduce con la misma condición que usa la 0017.

Dos riesgos que relevaste quedan **registrados y sin acción**, por decisión de Luciano: que cancelar una ausencia aprobada borre días importados de ese rango (el import es para el go-live, no una herramienta de corrección habitual), y que la edición manual del calendario no escriba en `audit_log`. **No los toques y no los cargues al Log.**

---

## Las seis decisiones

### 1. Concurrencia — aprobada tal cual

La función recalcula todo dentro de la transacción y **aborta si los conteos difieren** de lo que el admin vio en la previsualización. La previsualización es una foto; entre que la mira y confirma, algo puede cambiar.

Las filas sin cambios **no se tocan** — es lo que hace posible el test de ida y vuelta.

`es_estimado`: **`true` para días futuros** (son proyecciones, el cron las consolida después), **`false` para días pasados** (son días reales).

### 2. Emails de admin o de inactivos — aprobada

**Error**, igual que un email inexistente. El export no los incluye, así que un archivo que los traiga fue editado a mano y el admin tiene que enterarse.

### 3. Email único — las dos cosas, no una

Agregá el **índice único sobre el email en minúsculas** en la migración 0022 **y** tratá como **error** cualquier email del archivo que matchee más de un perfil. El índice es el arreglo real; la validación es la red por si el índice no estuviera.

Tres cuidados obligatorios:

- **El matcheo del import tiene que ser insensible a mayúsculas y con espacios recortados**, con el mismo criterio que el índice. Si el índice normaliza y el matcheo no, se desincronizan.
- **Verificá que hoy no haya duplicados por mayúsculas antes de crear el índice.** Si los hubiera, la migración falla al aplicarse. Comprobalo contra producción en la auditoría de esquema previa.
- **A partir del índice, dar de alta dos perfiles que difieran solo en mayúsculas pasa a ser imposible.** Es deseable, pero **es un cambio de comportamiento del alta de usuarios**: dejalo escrito en el informe de migración y en el PR, y verificá que el alta de Gestión de Usuarios devuelva un error legible en es-AR si alguien lo intenta, en vez de un error crudo de base.

### 4. Entrada de resumen — aprobada

`import_id` generado, usado como `record_id`, acción `calendario_importado`. Resuelve bien que `record_id` no pueda quedar vacío.

**Usá `PERFORM log_audit(...)`**, como la 0020. Que las funciones 0013–0019 escriban con `INSERT` directo es inconsistencia heredada: no la copies.

### 5. Definición de "pisar" — aprobada

Día cubierto por una solicitud aprobada y no cancelada, que el import cambia o borra. Con la misma condición que la 0017.

### 6. Rango y filas — aprobadas las cinco

- Rango de la fecha más temprana a la más tardía del archivo, tope de 366 días.
- Solo se tocan las filas presentes en el archivo.
- Fila duplicada → error.
- Nota o motivo con el estado vacío → error.
- Fecha que Excel convirtió a su formato interno → se acepta y se normaliza.

---

## Construcción

Seguí todo lo que ya dice `FB-PI-11` y que no cambia: molde `SECURITY DEFINER` de §6.1 completo (guardas internas contra `auth.uid()` con NULL como no-admin, `search_path` fijo, `EXECUTE` solo a `authenticated` con `REVOKE` de `anon` y `PUBLIC`, owner verificable por catálogo), **delta-only**, drift detector actualizado intencionalmente, `audit_log` en modelo híbrido (resumen por importación más entrada por-día solo de los días pisados), previsualización obligatoria con sus cinco bloques, upsert por `(email, fecha)`, `createServerClient()` nunca `createAdminClient()`, contrato return-based, copy es-AR, y el test de ida y vuelta.

---

## ⛔ Antes del `db push`

Frená y entregá:

- La migración escrita y el informe de **auditoría de esquema previa**, incluida la verificación de que no hay duplicados de email por mayúsculas en producción.
- CI verde en los tres jobs.

**El `db push` lo corre Luciano, por el runbook gateado** (§2.3): auditoría previa → push → verificación de catálogo (`owner`, `prosecdef`, `proconfig`, `proacl`) → `migration list` Local = Remote → regen de `types.ts --linked`, siempre.

**Reportá toda acción que toque producción.**

---

## Fuera de alcance

- Los dos riesgos registrados sin acción (cancelación de ausencia, edición manual sin auditoría).
- Corregir las funciones 0013–0019 para que usen `log_audit()`.
- Configuración de Gmail.
- **Cargar el historial de 3 meses:** lo hace Luciano desde la app, después del merge.

---

## Definición de Done

- [ ] Migración 0022 con el molde de §6.1 completo y el índice único de email en minúsculas.
- [ ] Ausencia de duplicados por mayúsculas verificada en producción **antes** del push.
- [ ] Cambio de comportamiento del alta de usuarios documentado, con error legible en es-AR.
- [ ] Drift detector actualizado.
- [ ] Previsualización obligatoria con los cinco bloques.
- [ ] Test de ida y vuelta con cero diferencias.
- [ ] Test de límite de rol para los 3 roles.
- [ ] CI verde en los tres jobs.
- [ ] Migración aplicada por el runbook gateado, con verificación de catálogo y regen de tipos.
- [ ] Excepción del `audit_log` registrada para llevar a la constitución.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11-B.md`.

**El merge lo autoriza Luciano. El `db push` lo corre Luciano.**
