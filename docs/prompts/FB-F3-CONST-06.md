# FB-F3-CONST-06 — Bump de la Constitución a v0.6

> **Tipo:** edición de documentación (`docs/constitucion.md`). **Sin código, sin tests, sin migración.** Es la última tarea de cierre de Fase 3.
> **Compuerta:** Luciano revisa el diff antes de mergear (no requiere auditoría de Codex por ser doc; opcional: Codex hace un chequeo de consistencia del diff contra los deltas).

---

## Objetivo

Subir `docs/constitucion.md` de **v0.5 a v0.6**, incorporando los aprendizajes y decisiones acumulados en la fase (Días de Trámite + pintado por rango) que hoy viven en prompts sueltos y no como regla oficial.

## Procedimiento

1. Leer la **v0.5 real** completa (no asumir su contenido).
2. Subir el número de versión a **v0.6**. Si el doc tiene changelog/historial de versiones, agregar entrada **v0.6** con fecha **2026-07-13** y un resumen de los deltas.
3. Incorporar los deltas de abajo en las secciones que correspondan. **Edición quirúrgica:** no reescribir secciones no afectadas; preservar numeración y estilo. Donde un delta **corrige** texto existente (§5), reemplazar el viejo, no duplicar.
4. Reportar un resumen del diff para revisión de Luciano.

## Deltas a incorporar

### A — Capa de notificaciones por email
- Email vía Gmail API (service account, domain-wide delegation, envía como `contacto@first-blades.com`, scope `gmail.send`). Patrón `notification_log` para idempotencia de alertas (franco/documentos). Skill `email-notification`.
- Principio: toda info que dispara un mail debe tener **representación consultable in-app**; el mail avisa, la app es la fuente.
- Mails de flujo (aprobación/rechazo) son **best-effort post-commit**: un fallo de envío no revierte la transacción ni rompe la consistencia; la representación in-app (estado de la solicitud) es la verdad.

### B — Patrón purgatorio para solicitudes de ausencia
- `ausencia_requests` (existente desde 0001) es el **patrón transversal** solicitud→aprobación para ausencias; **día de trámite es el primer tipo** que lo usa (Fase 4 reusa la tabla). Es **modelo de rango** (`fecha_inicio`/`fecha_fin`); para un día puntual, inicio = fin.
- Invariantes: no-admin inserta solo propio + `pendiente` (policy `ausencias_insert_non_admin`); ningún no-admin modifica `estado`; transición registrada en `audit_log`; rechazo exige motivo.
- La capa de app **superpone scope de negocio a la RLS**: la cola de aprobación filtra por motivo+estado, y la action **revalida el scope server-side** (`estado='pendiente'` + `motivo_ausencia='dia_tramite'`) antes de resolver — la RLS y la guarda de la RPC no limitan el motivo por diseño.

### C — Patrón RPC `SECURITY DEFINER` para transiciones atómicas multi-tabla
- Cuando una transición escribe en varias tablas todo-o-nada (ej. `resolver_ausencia_request`: estado + `audit_log` + calendario), va en una **función Postgres invocada con `.rpc()`**, no en escrituras secuenciales del cliente (que no dan transacción).
- Reglas de la función: `SECURITY DEFINER` con **`search_path` fijo explícito**; las **guardas internas son el control de seguridad principal** (admin chequeado contra `auth.uid()`, tratando **NULL como no-admin**, nunca desde un parámetro; estado `pendiente` con `SELECT ... FOR UPDATE` para serializar); `EXECUTE` solo a `authenticated`, con **`REVOKE` explícito de `anon`** (Supabase lo re-otorga por default) y de `PUBLIC`; **owner** de la función = rol de administración (no un rol de app), verificado por catálogo post-push.
- Las actions invocan la RPC con **`createServerClient()`**, NO `createAdminClient()`: `service_role` no tiene `sub` en el JWT y la guarda `auth.uid()` abortaría siempre.

### D — Gobernanza de migraciones y `db push`
- **Auditoría de esquema obligatoria antes del push** de toda migración no trivial (funciones con privilegios, constraints).
- **Delta-only:** inspeccionar el esquema real primero y escribir solo el delta; nunca asumir que la branch matchea prod.
- CI **valida** migraciones contra Postgres fresco pero **no las aplica**. Aplicar es un `db push` explícito, **gateado por Luciano**, con runbook (pre-push, push, **verificación de catálogo post-push** — para funciones: `owner`/`prosecdef`/`proconfig`/`proacl`; `migration list` Local=Remote; regenerar `types.ts --linked`).
- **Hallazgo incorporado:** hubo un push off-script (0012 llegó a prod fuera del gate). Regla: **todo `db push` va por runbook gateado**, y Claude Code **reporta cualquier acción que toque prod, aunque sea en otra sesión**.
- **Ruta sancionada de acceso a la base:** MCP de Supabase (apuntada a la org del cliente). La **conexión directa** a Postgres con `SUPABASE_DB_PASSWORD` es una **excepción** (para el push real u operaciones que la MCP no cubra), gateada y con higiene: solo lectura fuera del push, no imprimir la credencial, borrar scripts temporales.
- **Drift detector** (`migration.test.ts`): inventario exacto (`toEqual`) de enums/tablas/constraints/índices/funciones; para funciones `SECURITY DEFINER` incluir `prosecdef`, `proconfig` (search_path) y owner-consistency. Se actualiza intencionalmente al cambiar el esquema.

### E — Calendario / roster (incluye correcciones a §5)
- **Corrige §5:** `rotation_assignments` es **per-día** (una fila por `(user_id, fecha)`, `UNIQUE(user_id, fecha)`, columna `fecha`, `es_estimado` bool), **no** modelo de rango. (No confundir con `ausencia_requests`, que sí es rango.)
- **Corrige §5:** `profiles.dni` existe (text, `UNIQUE` desde 0009).
- `rotation_groups` es admin-only.
- Colores: 4 estados (trabajando verde, `en_franco` rojo, `periodo_fuera_trabajo` amarillo, `en_viaje` azul), sin cargar = gris. Los colores son **tokens cosméticos**, se ajustan sin refactor.
- `es_estimado`→real: cron nocturno cuando `fecha <= hoy+7`, "hoy" en `America/Argentina/Buenos_Aires` (`getBusinessToday`), nunca UTC crudo.
- **Pintado por rango:** edición admin de un rango para **una fila** (un `user_id`), **best-effort** (un fallo por día no aborta el resto; se reporta cada día fallido con motivo legible), `es_estimado` por fecha. **`dia_tramite` EXCLUIDO** del pintado por rango (se carga por su flujo de solicitud/aprobación). Gesto: click simple = edición de un día; shift-click fija ancla **sin abrir modal**; segundo shift-click misma fila abre el modal de rango.

### F — Días de trámite
- Flujo completo: solicitud del empleado → cola de aprobación admin → RPC atómica (estado + `audit_log` + upsert al calendario) → mails de resolución → saldo/consumo.
- **Saldo derivado del calendario, sin tabla ni contador:** consumidos = filas `dia_tramite` del año calendario; restantes = `3 − consumidos`; tope **3/año plano, no acumulable**; excedido cuando >3; **alerta no bloqueante** consultable in-app, independiente del camino (roster o solicitud aprobada).
- **`es_estimado` CUENTA** para el saldo de día de trámite (opuesto a la regla de franco, donde el estimado corta la racha). Regla explícita para no copiar por analogía.
- Año = año calendario vía `getBusinessToday` (zona AR).

### G — Roles y alcance de fases (deltas ya en cola para v0.6)
- 3 roles: admin, supervisor, empleado.
- Ausencias nativas (en la app); viáticos externos (fuera de la app).
- Calendario de 4 estados. Visma diferido.
- (Confirmar redacción contra lo que el doc ya diga; no duplicar.)

### H — Notas de deuda
- **e2e:** no hay Playwright en la compuerta de CI (solo unit + integración RLS). Bugs de interacción real de browser (ej. inertización de `<dialog>.showModal()`) no tienen compuerta automática; se cubren con guards RTL puntuales. Deuda a evaluar.
- **Parking lot de la fase:** Import/Export Excel (cargado en el log de Airtable), diferido a la decisión go/no-go post-MVP.

## Definition of Done

- `docs/constitucion.md` en **v0.6**, con todos los deltas incorporados y **§5 corregido** (rotation_assignments per-día; profiles.dni existe).
- Changelog v0.6 con fecha, si el doc tiene esa sección.
- Edición quirúrgica (sin reescribir lo no afectado), numeración y estilo preservados.
- PR dedicado **docs-only** (sin código/tests/migración).
- **Versionar el propio `.md`** en `docs/prompts/FB-F3-CONST-06.md`.
- Reportar resumen del diff para revisión de Luciano (compuerta de merge).

---

## Ejecución: resumen del diff (para revisión de Luciano)

Edición quirúrgica sobre `docs/constitucion.md` (v0.5 → v0.6). Numeración de secciones §1–§14 preservada; se agregaron subsecciones decimales (§2.3 ampliada, §2.4 nueva, §6.1 nueva) para no forzar una renumeración en cascada del resto del documento.

**Cambios por sección:**
- **Título / Estado (encabezado):** versión → v0.6; línea de estado resume los deltas de Fase 3 y declara Fases 0–3 cerradas.
- **§2 Stack técnico:** línea de notificaciones reescrita para apuntar a §2.4 (nueva). **§2.3** (gobernanza de migraciones) ampliada con: auditoría de esquema obligatoria + delta-only, runbook de push con verificación de catálogo post-push, el hallazgo del push off-script de 0012 + regla de reporte, ruta sancionada (MCP) vs. excepción (conexión directa), drift detector. **§2.4** (nueva): capa de notificaciones por email — service account, `notification_log`, principio "el mail avisa, la app es la fuente", mails de flujo best-effort post-commit.
- **§5 Modelo de datos:**
  - `profiles`: se agrega el campo `dni` (faltaba por completo).
  - `ausencia_requests`: nota ampliada con el rol de patrón transversal (día de trámite = primer tipo), invariantes (policy de insert, inmutabilidad de `estado` para no-admin, `audit_log`, revalidación server-side del scope) y la mecánica completa del saldo derivado (incluida la regla `es_estimado` cuenta, explícitamente no analógica con franco).
  - `rotation_groups` · `rotation_assignments`: **corrección real** — v0.5 documentaba un modelo de rango (`fecha_inicio`/`fecha_fin`) que nunca se construyó así; se reemplaza por el modelo per-día real (`UNIQUE(user_id, fecha)`, columnas reales) con nota explícita "Corrige v0.5". Se agrega la regla de `es_estimado`, la mecánica de pintado por rango (best-effort, exclusión de `dia_tramite`, gesto de shift-click) y que `rotation_groups` es admin-only.
- **§6 Modelo RLS:** la línea `rotation_*` se separa en `rotation_assignments` (como antes) + nota de que `rotation_groups` es admin-only sin `SELECT` para no-admin. **§6.1** (nueva): patrón RPC `SECURITY DEFINER` — cuándo usarlo, reglas de la función (search_path, guardas internas, REVOKE, owner), y por qué las actions usan `createServerClient()` y no `createAdminClient()`.
- **§9 Sistema de diseño:** colores de los 4 estados del calendario, antes marcados "propuestos, confirmar en Fase 2", ahora confirmados y mapeados a los tokens de marca existentes (verde/rojo/amarillo/azul = success/error/warning/primary).
- **§11 Skills:** se agrega `email-notification`.
- **§12 Seguridad:** dos ítems nuevos (6, 7) — funciones `SECURITY DEFINER` y gobernanza de `db push` como focos de auditoría.
- **§13 Definición de Done:** cláusula ampliada para exigir verificación de catálogo en funciones `SECURITY DEFINER`.
- **§14 Pendientes:** se resuelven y remueven los ítems "dirección de Gmail" y "colores del calendario" (ambos cerrados por esta misma fase); la lista se renumera; se agregan dos ítems de deuda nuevos (e2e fuera de la compuerta de CI; parking lot de Import/Export Excel). Se agrega **"Decisiones cerradas (v0.6) — 2026-07-13"** como bloque nuevo, preservando intacto el de v0.5.

**Deltas NO incorporados como texto nuevo porque ya estaban cubiertos** (delta G): 3 roles, ausencias nativas, viáticos externo, calendario de 4 estados y Visma diferido ya estaban en §4 y en "Decisiones cerradas (v0.5)" — se confirmó la redacción existente, no se duplicó.

**Dos inconsistencias preexistentes que quedaron señaladas pero NO corregidas** (ningún delta las pedía, así que no se tocaron para mantener la edición quirúrgica): los encabezados `### Alcance del módulo Calendario (Fase 2)` y `### Alcance de Viáticos (Fase 3)` en §5 conservan la numeración de fases que anticipaba v0.5, que ya no coincide con cómo se ejecutó realmente el trabajo (Calendario se construyó en lo que este ciclo llamó "Fase 3"). Queda a criterio de Luciano si amerita una limpieza de numeración de fases en una revisión futura.
