# First Blades — Constitución del Portal (v0.8.1)

> **Estado:** Fases 0, 1, 2, 3, 4 y 5 cerradas; Fase 6 en curso. v0.6 incorporó aprendizajes de Fase 3 (ver más abajo). v0.7 incorpora los deltas de Fase 4: pasajes con días discretos (`dias_viaje`), no-solapamiento de pendientes por exclusion constraint, edición/cancelación post-aprobación admin-directo con guarda LIFO, `audit_log` de calendario por-día parejo en ausencia y pasaje (sin divergencia), contrato return-based de Server Actions, y e2e Playwright cableado como tercer job de CI. v0.7.1 (FB-ADJ-01, ajuste inter-fase) incorpora: admin envía Solicitud de Ausencia/Pasaje para sí con auto-aprobación (excepción explícita a "nada se autoactiva"), y el renombre de etiqueta "Formularios" → "Ingreso". v0.8 incorpora los deltas de Fase 5: módulo Procedimientos/Políticas construido (RLS por estado, RPCs `SECURITY DEFINER`, `log_audit()` cerrada a `anon`/`authenticated`), Gestión de Usuarios con reseteo de contraseña y baja con motivo/fecha, gate de acceso server-side (`activo`-only, mensajes indistinguibles), y el ajuste inter-fase `FB-ADJ-03`: el módulo "Ingreso" se descarta antes de construirse y `employee_status` queda con dos valores (`activo`, `inactivo`) — migración `0021`. Incorpora también el proceso de dos niveles de rigor de auditoría (migraciones vs. features) acordado con Luciano. v0.8.1 (`FB-F6-01`) agrega el ítem de menú **Inventario** (solo admin), placeholder por ahora — el destino externo real se cablea en `FB-F6-02`.
> **Propósito:** Fuente única de verdad del portal de First Blades. El chat PM la sostiene y la adjudica. Claude Code construye *según* ella. Codex la audita *contra* ella. Cada chat de módulo la hereda.
> **Idioma:** Documento en español (es-AR). Todo el producto en español (es-AR).

---

## 1. Modelo operativo (fijo)

| Actor | Rol | Produce |
|---|---|---|
| **Proyecto (chat PM)** | Criterio. Sostiene la spec, planifica, escribe prompts, adjudica. | PRDs, desglose de tareas, prompts de build, prompts de auditoría |
| **Claude Code** | El constructor. Escribe código de features + tests, abre PRs. | Código, migraciones, tests |
| **Codex** | Auditor independiente. Revisa los diffs contra el PRD + esta constitución. **Nunca escribe código de features.** | Hallazgos de auditoría |
| **Repo (CI)** | Cumplimiento. Las compuertas se sostienen acá, no en el chat. | Pass/fail de tests, typecheck, lint, build |
| **Luciano** | Enlace humano entre herramientas, y compuerta final. | Decisiones, aprobaciones |

### 1.1 Proceso de auditoría y merge (Fase 5)

- **Dos niveles de rigor.** Migraciones: ceremonia completa — inspección, auditoría, re-auditoría si hay hallazgos, merge, runbook gateado (§2.3), verificación de catálogo, regen de tipos. **Piezas de interfaz y features:** auditoría de Codex sí, pero el Developer triagea los hallazgos; se arregla lo bloqueante antes del merge y el resto va al Log; **sin re-auditoría** salvo que haya algo bloqueante.
- **Versionado del informe verbatim:** obligatorio antes del merge en migraciones; en features se versiona junto al merge.
- Los informes de Codex se piden **dentro de un bloque de código**, para que el Markdown no se aplane en el traslado y el verbatim sea fiel.
- **Todo prompt que arranque con una inspección debe pedir su informe versionado explícito.** Embeberla en el prompt deja el relevamiento solo en el chat.
- **La autorización de merge es de Luciano, sin excepción** — incluidos los PRs doc-only o de archivos generados.

---

## 2. Stack técnico

- **Framework:** Next.js (App Router) + TypeScript (strict).
- **Fuente de verdad:** Supabase — Postgres, Auth, Storage, Row-Level Security (par de keys publishable/secret).
- **Hosting:** Vercel — **la app ya está en producción** (deploy adelantado en Fase 1; dominio, SSL, env vars). **Sin entorno de staging separado** — riesgo a gestionar: cuidado con pruebas destructivas contra la base real.
- **Testing/CI:** Vitest + Playwright; GitHub Actions.
- **Notificaciones (app):** Gmail API (service account, domain-wide delegation) — ver §2.4.
- **Viáticos / Rendición de Gastos: externo en Google Workspace** — Google Form → Drive → Sheets → Apps Script. Se accede por **link** desde la app. No usa n8n.

### 2.1 Autenticación
- **Email + contraseña.** El admin crea el usuario con una **contraseña inicial** desde Gestión de Usuarios. Sin mail de invitación, sin magic link, sin OAuth.
- El **primer admin** se siembra por seed (`FIRST_ADMIN_EMAIL`). Esto deja la app sin dependencia de email para arrancar.
- **Validación de contraseña:** mínimo 8 caracteres, al menos un número y una mayúscula — helper único, validado server-side, compartido por el alta y por el reseteo (Fase 5).
- **Reseteo de contraseña (Fase 5, Gestión de Usuarios):** el admin tipea una contraseña nueva para un usuario existente, igual que en el alta. Requiere el **admin client** de Supabase Auth por naturaleza de la operación (no hay otra forma de resetear la contraseña de otro usuario), pero solo se alcanza **después** de verificar admin por sesión con `createServerClient()` — el admin client nunca es la primera puerta. La escritura en `audit_log` de esa operación también usa el admin client, con `actor_id` tomado de la sesión ya verificada: escribir con `service_role` sin pasarlo explícito deja el autor en `NULL`.
- **Gate de acceso: solo `status = 'activo'` entra**, verificado server-side en `requireAuth()` — ver §12.

### 2.2 Contrato de entorno
- `.env.example` commiteado; `.env.local` nunca se sube (gitignored). Secretos solo por variables de entorno.

### 2.3 Despliegue de migraciones (gobernanza)
- **CI valida pero NO aplica** los cambios a la base remota. Tras CI verde, todo cambio de esquema requiere un `supabase db push` **explícito** y **verificación en producción**. Ningún cambio de base de datos está "hecho" hasta aplicarse y verificarse en prod.
- **Auditoría de esquema obligatoria antes del push** de toda migración no trivial (funciones con privilegios, constraints). **Delta-only:** inspeccionar el esquema real primero y escribir solo el delta; nunca asumir que la branch matchea prod.
- **Runbook de push** (gateado por Luciano): pre-push (auditoría de esquema) → push → **verificación de catálogo post-push** (para funciones: `owner` / `prosecdef` / `proconfig` / `proacl`) → `migration list` Local=Remote → regenerar `types.ts --linked`.
- **Hallazgo incorporado (Fase 3):** hubo un push off-script (la migración 0012 llegó a producción fuera del gate). Regla: **todo `db push` va por el runbook gateado**, y Claude Code **reporta cualquier acción que toque producción, aunque sea en otra sesión**.
- **Ruta sancionada de acceso a la base:** MCP de Supabase (apuntada a la org del cliente). La **conexión directa** a Postgres con `SUPABASE_DB_PASSWORD` es una **excepción** —para el push real u operaciones que la MCP no cubra—, gateada y con higiene: solo lectura fuera del push, no imprimir la credencial, borrar scripts temporales.
- **Drift detector** (`migration.test.ts`): inventario exacto (`toEqual`) de enums/tablas/constraints/índices/funciones; para funciones `SECURITY DEFINER` incluye `prosecdef`, `proconfig` (search_path) y owner-consistency. Se actualiza intencionalmente al cambiar el esquema. **Todo enum de dominio nuevo o modificado necesita su propio test de valores exactos** (no alcanza con que el tipo figure en el inventario de nombres) — hueco detectado y cerrado en `FB-ADJ-03` para `employee_status`.
- **El regen de `types.ts` se aplica siempre**, aunque el diff contra el archivo commiteado sea de infraestructura (ej. `PostgrestVersion`) y no de esquema — el diff cero del runbook solo sirve como señal de drift si el archivo se mantiene al día; un valor desactualizado hace que el próximo regen real muestre el mismo diff sin forma de distinguir residuo de novedad.
- **Estado actual:** migraciones `0001`–`0021` aplicadas y verificadas en producción.

### 2.4 Notificaciones por email
- Gmail API vía **service account con domain-wide delegation**, envía como `contacto@first-blades.com`, scope `gmail.send`. Patrón `notification_log` para idempotencia de alertas recurrentes (franco, vencimiento de documentos). Skill `email-notification`.
- **Principio:** toda información que dispara un mail debe tener **representación consultable in-app**; el mail avisa, la app es la fuente de verdad.
- Los mails de flujo (aprobación/rechazo) son **best-effort post-commit**: un fallo de envío no revierte la transacción ni rompe la consistencia; la representación in-app (estado de la solicitud) es la verdad.

### 2.5 Contrato return-based de Server Actions (Fase 4)
- Un `throw new Error(mensajeAmigable)` que cruza el límite de una Server Action llega **redactado** en producción (Next.js oculta el mensaje real de cualquier error no capturado que cruce ese límite) — el usuario ve un mensaje genérico en vez del copy es-AR pensado para él.
- Regla: las actions que pueden fallar de forma esperada **devuelven** `{ ok: boolean, error?: string }` en vez de tirar; los call sites chequean `!ok` y muestran `error` (copy es-AR), sin depender de que el mensaje del `throw` llegue crudo al cliente.
- Cerrado en Fase 4 (`lib/storage.ts` y el flujo de documentos) tras detectar mensajes redactados en prod; el contrato aplica a toda Server Action nueva.
- **Excepción (FB-F5-AUD-05, Fase 5):** el contrato aplica a los **errores de negocio de una llamada ya autorizada** (RPC que falla, validación que no pasa). Los **guards de rol** (ej. `requireAdmin()`) cortan por `redirect()`, no por `{ ok }`: `redirect()` no es un `throw` que Next redacte, es su propio mecanismo — y a un no-admin no hay un mensaje de negocio que darle.
- **Errores de PostgREST como valor (Fase 5):** un `try/catch` **no** captura el `{ error }` que devuelve un `.insert()`/`.update()` fallido del cliente de Supabase — PostgREST no tira, devuelve el error como parte del resultado. Hay que leerlo explícitamente y no asumir que el `try/catch` alrededor lo cubre. Aplica a toda escritura no bloqueante, como las entradas de auditoría best-effort.

---

## 3. Estructura del repositorio

```
/app                 # rutas (App Router), sensibles al rol
/components          # UI compartida (sobre el sistema de diseño)
/lib                 # cliente supabase, helpers de auth, utils
/lib/copy            # textos de UI centralizados en español (es-AR)
/supabase/migrations # migraciones de esquema versionadas
/public              # logo.fb.png + assets estáticos
/tests               # tests unitarios + de integración
/.claude/skills      # skills de build reutilizables (creadas en Fase 0)
/docs                # esta constitución + PRDs por módulo
CLAUDE.md            # contexto operativo para Claude Code
```

---

## 4. Roles y permisos

Tres roles: **Administrador**, **Supervisor**, **Empleado**.

| Módulo | Administrador | Supervisor | Empleado |
|---|---|---|---|
| Mi Perfil | Ve + edita el propio | Ve el propio (lectura; edita por formularios) | Ve el propio (lectura; edita por formularios) |
| Equipo (datos completos) | Ve todos + alertas de vencimiento | — | — |
| Calendario | Gestiona rotaciones del equipo | Ve su calendario + el de su equipo (lectura) | Ve su calendario (lectura) |
| Solicitud de Pasaje | Envía para sí (auto-aprobado) + aprueba en Aprobaciones | Envía para sí y para su equipo | Envía para sí |
| Solicitud de Ausencia (Período fuera del trabajo) | Envía para sí (auto-aprobado) + aprueba en Aprobaciones | Envía para sí | Envía para sí |
| Carga de Documentos | Carga + (aprueba en Aprobaciones) | Envía propios (→ Pendiente) | Envía propios (→ Pendiente) |
| **Aprobaciones** | **Bandeja única: pasajes, ausencias, documentos** | — | — |
| Gestión (usuarios) | Crea usuarios, asigna rol + supervisor, resetea contraseñas, da de baja (motivo + fecha obligatorios) | — | — |
| Rendición de Gastos (Google Form, externo) | Revisa (en Sheets) | Carga comprobantes (link) | Carga comprobantes (link) |
| Procedimientos / Políticas | Gestiona documentos | Lectura | Lectura |
| Inventario (externo) | Ve el ítem (placeholder — destino externo se cablea en `FB-F6-02`) | — | — |

Notas:
- **Supervisor = capacidades de Empleado + pide pasajes para su equipo + ve el calendario de su equipo (lectura).** No accede a administración de calendario, ni a Equipo completo, ni a Gestión, ni a Aprobaciones.
- "Empleados a cargo" se define por `supervisor_id` en `profiles`.
- Empleado y Supervisor **nunca** editan su perfil directamente: todo cambio pasa por formularios → Pendiente → Aprobaciones (admin).
- Permisos aplicados a **nivel de base de datos vía RLS**, no solo en la UI.
- **FB-ADJ-01 (v0.7.1):** el Administrador puede enviar Solicitud de Ausencia y Solicitud de Pasaje **para sí mismo** (admin-para-sí solamente, no por otros); esa solicitud se **auto-aprueba** al enviarla (con diálogo de confirmación previo), sin pasar por la bandeja Aprobaciones — ver la excepción explícita en §7.
- **FB-ADJ-03 (v0.8):** el módulo "Ingreso" (precarga de candidatos sin cuenta) se descartó antes de construirse — no es "próximamente", **no existe**. Ver §8, que documentaba ese flujo y quedó corregido.
- **FB-F6-01 (v0.8.1):** ítem de menú **Inventario**, solo admin, ubicado inmediatamente debajo de Rendición de Gastos. Placeholder en esta tarea (mismo comportamiento no-navegable que Rendición de Gastos hoy); el destino externo real se cablea en `FB-F6-02`.

---

## 5. Modelo de datos (Supabase / Postgres)

Enums:
- `employee_status`: `activo` | `inactivo` — **quedó en dos valores con `FB-ADJ-03` (v0.8, migración `0021`)**; tenía un tercero, `pendiente`, previsto para la precarga de candidatos del módulo "Ingreso" (§8), que nunca llegó a tener caso de uso real (0 filas en producción) y se eliminó junto con el módulo. Postgres no soporta `DROP VALUE`: la migración recreó el tipo.
- `approval_status`: `pendiente` | `aprobado` | `rechazado` — dominio del patrón Purgatorio (§7), no confundir con `employee_status`: comparten el literal `pendiente` pero son tipos distintos, y solo el de `approval_status` sigue vigente con ese valor.
- `user_role`: `admin` | `supervisor` | `empleado`
- `estado_dia` (calendario): `trabajando` | `en_viaje` | `en_franco` | `periodo_fuera_trabajo`
- `motivo_ausencia`: `vacaciones` | `licencia_medica` | `dia_tramite` | `matrimonio` | `fallecimiento` | `otros`
- `motivo_viaje` (pasaje): `inicio_franco` | `fin_franco` | `traslado_proyectos`
- `post_aprobacion_tipo` (Fase 4): `editada` | `cancelada` — marca el cambio post-aprobación admin-directo (ver §6.1/§6.2), nullable en ambas tablas de solicitud mientras no hubo cambio
- `procedure_estado` (Fase 5): `vigente` | `archivado` — archivado de `procedures`, aplicado también en la RLS (ver §6)
- `certificado_tipo` (Fase 1): `gwo` | `cursos_elevadores` | `espacio_confinado` | `manejo_defensivo` | `cursos_vestas` | `otros` — tipo de certificado en `documents`
- `notification_type` (Fase 2): tipos de alerta que dedupan por `notification_log` (franco, vencimiento de documentos) — ver §2.4

### `profiles`
`id` (uuid, FK auth.users) · `role` (user_role) · `status` (employee_status, **NOT NULL DEFAULT 'activo'**) · `supervisor_id` (uuid, FK profiles, nullable) · `full_name` · `email` (login) · `telefono` · `cuit` · `dni` (text, **UNIQUE**, nullable — clave de import de historial) · `winda_id` · `entrevista_tecnica` (jsonb, **solo admin**) · `motivo_baja` (text, nullable) · `fecha_baja` (date, nullable) · `created_at` · `updated_at`
> **Fase 5 — baja:** `motivo_baja`/`fecha_baja` son nullable en la base (un usuario `activo` no tiene motivo de baja) pero **obligatorias en la aplicación** al inactivar — la Server Action las exige, no un CHECK, para no acoplar la migración a una regla de UI. Reactivar limpia ambos campos.

### `documents` — tabla unificada de purgatorio
`id` · `profile_id` · `tipo` (`dni` | `licencia` | `foto_carnet` | `estudio_medico` | `certificado`) · `certificado_tipo` (`gwo` | `espacio_confinado` | `manejo_defensivo` | `otros`, nullable) · `certificado_otros_texto` (varchar 30, nullable) · `file_path` · `fecha_vencimiento` (nullable) · `estado` (approval_status) · `motivo_rechazo` (nullable) · `submitted_by` · `reviewed_by` · `submitted_at` · `reviewed_at`
> **Retención:** los documentos rechazados se purgan a los 30 días (se borra el archivo en Storage; se conserva el registro).

### `pasaje_requests`
`id` · `solicitante_id` · `empleado_id` · `motivo_viaje` · `detalle` (jsonb) · `estado` · `motivo_rechazo` · `reviewed_by` · `submitted_at` · `reviewed_at`
> **Fase 4 — `dias_viaje` (`date[]`, nullable):** días discretos del viaje, no un rango — a diferencia de `ausencia_requests`, un viaje puede tener días sueltos (ej. ida y vuelta con días intermedios sin franco). CHECK `pasaje_requests_dias_viaje_no_vacio`: si no es NULL, no puede ser un array vacío. Al aprobarse, expande cada fecha de `dias_viaje` en una fila `en_viaje` per-día en el calendario de `empleado_id` (ver §6.1, `resolver_pasaje_request`).
> **Fase 4 — post-aprobación:** `post_aprobacion_tipo` (enum, nullable) · `comentario_post_aprobacion` (text, nullable) · `post_aprobacion_at` (timestamptz, nullable) — ver §6.1/§6.2, `cancelar_editar_pasaje_aprobado`.

### `ausencia_requests`
`id` · `profile_id` · `motivo` (motivo_ausencia) · `motivo_otros_texto` (nullable) · `fecha_inicio` · `fecha_fin` · `estado` · `motivo_rechazo` · `reviewed_by` · `submitted_at` · `reviewed_at`
> Al aprobarse, genera el estado `periodo_fuera_trabajo` en el calendario con su motivo (ver §6.1 para el patrón RPC que ejecuta esta transición). Es el **patrón transversal** solicitud→aprobación para ausencias — **día de trámite es el primer tipo** que lo usa (Fase 4 reusa la tabla para los demás motivos). **Modelo de rango** (`fecha_inicio`/`fecha_fin`); para un día puntual, inicio = fin — no confundir con `rotation_assignments`, que es per-día.
>
> Invariantes: no-admin inserta solo lo propio + `estado='pendiente'` (policy `ausencias_insert_non_admin`); ningún no-admin modifica `estado`; toda transición se registra en `audit_log`; el rechazo exige motivo. La capa de app **superpone scope de negocio a la RLS**: la cola de aprobación filtra por motivo + estado, y la action **revalida el scope server-side** (`estado='pendiente'` + `motivo_ausencia='dia_tramite'`) antes de resolver — la RLS y la guarda de la RPC no limitan el motivo por diseño.
>
> **Saldo de días de trámite** — derivado del calendario, sin tabla ni contador propio: consumidos = filas `dia_tramite` del año calendario (`getBusinessToday`, zona `America/Argentina/Buenos_Aires`); restantes = `3 − consumidos`; tope **3/año plano, no acumulable**; excedido cuando `> 3`; alerta no bloqueante, consultable in-app, sin importar el camino de carga (roster admin o solicitud aprobada). **`es_estimado` SÍ cuenta** para este saldo — regla explícita, no copiar por analogía la lógica de otras alertas del calendario donde un día estimado no cuenta.
>
> **Fase 4 — no-solapamiento de pendientes:** `ausencia_requests_no_solapamiento_pendiente` (exclusion constraint, `btree_gist`: `EXCLUDE USING gist (user_id WITH =, daterange(fecha_inicio, fecha_fin, '[]') WITH &&) WHERE (estado = 'pendiente')`) reemplazó el índice de duplicados exactos — bloquea a nivel de base que un mismo `user_id` tenga dos solicitudes **pendientes** con rangos que se superpongan, sin importar el motivo. Contra una solicitud ya **aprobada** se permite igual, con alerta de sobrescritura no bloqueante (ver §6.2).
> **Fase 4 — post-aprobación:** `post_aprobacion_tipo` (enum, nullable) · `comentario_post_aprobacion` (text, nullable) · `post_aprobacion_at` (timestamptz, nullable) — ver §6.1/§6.2, `cancelar_editar_ausencia_aprobada`.

### `rotation_groups` · `rotation_assignments`
> **Corrige v0.5:** `rotation_assignments` es **per-día** (una fila por `(user_id, fecha)`), no modelo de rango — v0.5 anticipaba `fecha_inicio`/`fecha_fin`, pero eso no matcheó lo construido. No confundir con `ausencia_requests`, que sí es un modelo de rango.

`rotation_assignments`: `id` · `user_id` (FK profiles) · `fecha` · `estado_dia` · `es_estimado` (bool) · `motivo_ausencia` (nullable, requerido si `periodo_fuera_trabajo`) · `motivo_otros_texto` (nullable) · `rotation_group_id` (nullable, FK rotation_groups) · `notas` · `created_at` · `updated_at`. **`UNIQUE(user_id, fecha)`.**
> `es_estimado` → `false` (real) vía cron nocturno cuando `fecha <= hoy + 7`; "hoy" siempre en zona `America/Argentina/Buenos_Aires` (`getBusinessToday`), nunca UTC crudo.
>
> **Pintado por rango:** el admin edita un rango de fechas consecutivas para **una fila** (un `user_id`) de una sola vez. Escritura **best-effort**: un fallo por día no aborta el resto, se reporta cada día fallido con motivo legible; reintentar es seguro (upsert idempotente). `es_estimado` se recalcula por fecha. **`dia_tramite` queda excluido** del pintado por rango — se carga solo por su flujo de solicitud/aprobación (ver `ausencia_requests` arriba), para no saltear el purgatorio ni descuadrar el saldo. Gesto: click simple edita un día; shift-click fija el ancla del rango **sin abrir ningún modal**; el segundo shift-click en la misma fila abre el modal de rango.
>
> `rotation_groups` es **admin-only** (sin `SELECT` para no-admin) — tabla inerte en Fase 3, sin UI ni consumidor de grupos.

### `procedures` (Fase 5)
`id` · `titulo` · `contenido_texto` (nullable) · `file_path` (nullable) · `categoria` (text libre, con sugerencias en la UI) · `estado` (`procedure_estado`, **NOT NULL DEFAULT 'vigente'**) · `created_by` · `updated_by` · `created_at` · `updated_at`
> **CHECK `procedures_contenido_presente`:** exige al menos uno de `contenido_texto` o `file_path` — whitespace cuenta como ausente (`!~ '^[[:space:]]*$'`). La app además los trata como **excluyentes** (archivo *o* texto, no ambos), decisión de producto que no está en la base — la base solo exige "al menos uno".
> **Storage:** bucket `procedimientos`, privado; escritura solo admin, lectura para cualquier autenticado; MIME limitado a PDF / Word / texto plano. A diferencia del bucket `documents`, el path **no** lleva `{userId}` — un procedimiento es de la empresa, no tiene dueño individual.
> **Archivado:** oculto en la RLS (`USING`), no solo en la query de la app — ver §6.

### `audit_log`
Bitácora de auditoría genérica (`actor_id`, `action`, `table_name`, `record_id`, `old_data`, `new_data`, `created_at`), escrita vía `PERFORM public.log_audit(...)` desde dentro de las funciones `SECURITY DEFINER` transaccionales (§6.1) — nunca por `INSERT` directo del cliente.
> **`log_audit()` cerrada (Fase 5):** `EXECUTE` revocado de `anon`, `authenticated` y `PUBLIC` — queda invocable solo como helper interno de otra función `SECURITY DEFINER` (que corre con los privilegios de su owner, no del invocador). **Antes de este cierre, cualquier usuario autenticado podía insertar entradas falsas en `audit_log` directamente vía REST**, sin pasar por ninguna transición real.

### Alcance del módulo Calendario (Fase 2) — documentado
Alertas (48/60 días sin franco; 10–12 días de franco; solo admin, informativas) · días de trámite (3/año, no acumulables, historial por empleado) · reglas de viaje (>12 h = día de viaje; `motivo_viaje` actualiza calendario) · vista roster (mensual, por rango, futuros "estimados") · carga de 60 días de historial pre-lanzamiento.

### Alcance de Viáticos (Fase 3) — externo
Google Form → Drive → Sheets → Apps Script (Carla revisa, mails por cambio de estado). Backlog: análisis de facturas con IA + dashboard.

### Alcance del módulo Procedimientos / Políticas (Fase 5) — documentado
Una pantalla para los tres roles; edición y archivado visibles solo para el admin, sin purgatorio (publicación directa). Búsqueda por título y categoría (`ilike` server-side, sin `pg_trgm` — volumen de decenas de filas). Categoría de texto libre con sugerencias, no un enum cerrado. Contenido: archivo o texto Markdown (sanitizado server-side con `marked` + `sanitize-html`), excluyente por decisión de la app (§5, `procedures`). Badge "Nuevo" 7 días desde `updated_at`, igual para todos los roles, sin acuse de lectura por usuario.

---

## 6. Modelo RLS

- **profiles:** Empleado/Supervisor `SELECT` su fila; Supervisor además `SELECT` su equipo (`supervisor_id = auth.uid()`); sin `UPDATE`. Admin completo.
- **documents:** Empleado/Supervisor `SELECT`/`INSERT` propios (estado forzado `pendiente`, sin cambiar `estado`); Admin completo.
- **pasaje_requests:** Empleado `INSERT`/`SELECT` propios; Supervisor para/de su equipo; Admin completo.
- **ausencia_requests:** Empleado/Supervisor `INSERT`/`SELECT` propios; Admin completo.
- **rotation_assignments:** Empleado `SELECT` su calendario; Supervisor su calendario + el de su equipo; sin escritura. Admin completo. **rotation_groups** es **admin-only** (sin `SELECT` para no-admin).
- **procedures (Fase 5):** Empleado/Supervisor `SELECT` solo `estado = 'vigente'` (el archivado se oculta en la RLS, no solo en la query de la app); Admin `SELECT` todo + escritura completa (vía las RPCs de §6.1).

### 6.1 Patrón RPC `SECURITY DEFINER` para transiciones atómicas
- Cuando una transición escribe en varias tablas todo-o-nada (ej. `resolver_ausencia_request`: estado + `audit_log` + calendario), va en una **función Postgres invocada con `.rpc()`**, no en escrituras secuenciales del cliente (que no dan transacción).
- Reglas de la función: `SECURITY DEFINER` con **`search_path` fijo explícito**; las **guardas internas son el control de seguridad principal** (admin chequeado contra `auth.uid()`, tratando **NULL como no-admin**, nunca desde un parámetro; estado `pendiente` con `SELECT ... FOR UPDATE` para serializar); `EXECUTE` solo a `authenticated`, con **`REVOKE` explícito de `anon`** (Supabase lo re-otorga por default) y de `PUBLIC`; **owner** de la función = rol de administración (no un rol de app), verificado por catálogo post-push (ver §2.3).
- Las actions invocan la RPC con **`createServerClient()`**, NO `createAdminClient()`: `service_role` no tiene `sub` en el JWT y la guarda `auth.uid()` abortaría siempre.
- **RPCs vigentes (Fase 4):** `resolver_ausencia_request` (aprobar/rechazar, propaga el motivo per-día al calendario) · `resolver_pasaje_request` (aprobar/rechazar, expande `dias_viaje` en filas `en_viaje` per-día en el calendario de `empleado_id`) · `cancelar_editar_ausencia_aprobada` / `cancelar_editar_pasaje_aprobado` (cambio post-aprobación admin-directo, ver §6.2). Las cuatro comparten el molde de guardas de este parágrafo.
- **RPCs vigentes (Fase 5):** `crear_procedimiento` / `actualizar_procedimiento` / `archivar_procedimiento` — mismo molde de guardas (`is_admin()` interna, `search_path` fijo, `REVOKE` de `anon`/`PUBLIC`), escriben `procedures` + `audit_log` en la misma transacción vía `PERFORM public.log_audit(...)` (§5, `audit_log`).
- **`audit_log` de calendario por-día, parejo en todo el sistema (Fase 4, 0018):** toda escritura sobre `rotation_assignments` que dispara una de estas RPCs deja **una fila de `audit_log` por día afectado** (`table_name='rotation_assignments'`, `record_id` real de la fila, `old_data`/`new_data` de esa celda puntual), además de la fila de transición de la solicitud. Ausencia se alineó a la convención que ya usaba pasaje — ya no hay divergencia de granularidad entre los dos lados.
- **`log_audit()` cerrada (Fase 5):** dejó de ser invocable directamente por `anon`/`authenticated` vía REST (`EXECUTE` revocado); solo corre como helper interno por `PERFORM` desde las funciones `SECURITY DEFINER` de este parágrafo, con los privilegios del owner de la función, no del invocador. Ver §5, `audit_log`.

### 6.2 Reglas de negocio — ausencias y pasajes (Fase 4)
- **No-solapamiento sólo entre pendientes** (ver §5, `ausencia_requests_no_solapamiento_pendiente`): bloqueado a nivel de base entre solicitudes pendientes del mismo usuario, cualquier motivo. Contra una solicitud ya aprobada se permite — la sobrescritura del calendario queda auditada por-día (§6.1) y advertida en la UI, no bloqueada.
- **No-retroactiva (server-side):** tanto ausencias como pasajes rechazan, del lado servidor, fechas ya pasadas — no es solo una restricción de UI que se pueda saltear.
- **Edición post-aprobación admin-directo** (`cancelar_editar_ausencia_aprobada` / `cancelar_editar_pasaje_aprobado`, §6.1): comentario obligatorio; `cancelar` libera los días (vuelven a quedar sin asignar); `editar_fechas` borra los días/rango viejos y reescribe los nuevos. **Guarda LIFO:** bloquea la cancelación/edición si existe otra aprobación posterior (ausencia o pasaje, cruzando tipos) cuyo rango de días se solape aunque sea parcialmente, evaluada en orden `reviewed_at` — hay que resolver esa primero. El cambio queda visible in-app para el empleado.

---

## 7. Patrón Purgatorio (transversal — app)

Aplica a: documentos de perfil, solicitudes de pasaje y solicitudes de ausencia. *(Ya no aplica a onboarding/precarga — ese módulo se descartó en `FB-ADJ-03`, v0.8, ver §4/§8.)*

```
Empleado/Supervisor envía (formulario nativo)
   → registro con estado = pendiente   (nada se autoactiva)
   → entra a la bandeja única Aprobaciones (solo admin)
   → Admin aprueba (aplica efecto) / rechaza (+ motivo → se notifica para corregir)
```
> Todas las solicitudes confluyen en **una sola bandeja Aprobaciones**, no se aprueban dentro de cada módulo. **Viáticos NO usa este patrón** (vive en Google Sheets).

> **Excepción explícita (FB-ADJ-01, v0.7.1):** una solicitud de Ausencia o de Pasaje que un **Administrador envía para sí mismo** se **auto-aprueba** al enviarla (con diálogo de confirmación previo) — no entra a la bandeja Aprobaciones. El registro queda completo (`reviewed_by`/`reviewed_at` = el propio admin, `audit_log` legible como auto-aprobación: el solicitante es también el aprobador). Es la **única** excepción a "nada se autoactiva"; todo lo demás (envíos de empleado o supervisor, y cualquier solicitud de un admin para otra persona — fuera de alcance) sigue pasando por el purgatorio sin excepción.

---

## 8. Ciclo de vida del empleado

- Estados (`employee_status`, §5): **Activo** (acceso completo — el gate de §12 solo deja entrar este estado) · **Inactivo** (desvinculado; historial preservado, `motivo_baja`/`fecha_baja` obligatorios en la app).
- **Alta:** el admin crea el usuario desde Gestión de Usuarios con una contraseña inicial (§2.1) y `status='activo'` explícito, sin depender del default.
- **Baja:** el admin inactiva con motivo y fecha obligatorios (§5, `profiles`); reactivar limpia ambos campos.
- **`FB-ADJ-03` (v0.8):** este ciclo de vida tenía un tercer estado previsto, **Pendiente**, para un módulo de precarga (candidatos sin cuenta subiendo documentación por un link externo antes de tener usuario). Ese módulo — "Ingreso" en el menú — se descartó antes de construirse (§4); el estado `pendiente` nunca tuvo un caso de uso real (0 filas en producción) y se eliminó del enum. No hay flujo de precarga: todo alta pasa por el admin desde Gestión de Usuarios.

---

## 9. Sistema de diseño

Tokens de marca: `--color-primary #0D7EC7` · `--color-secondary #003E68` · `--color-neutral #666666` · `--color-bg #FFFFFF`.
Soporte: `--color-surface #F4F6F8` · `--color-border #E2E8F0` · `--color-success #2E7D32` · `--color-error #C62828` · `--color-warning #F9A825`.
Estados del calendario (**confirmados en Fase 3**): `trabajando` verde (`#2E7D32`, `--color-success`) · `en_franco` rojo (`#C62828`, `--color-error`) · `periodo_fuera_trabajo` amarillo (`#F9A825`, `--color-warning`) · `en_viaje` azul (`#0D7EC7`, `--color-primary`) · sin asignar = gris. Tokens cosméticos: se ajustan sin refactor.
Badges: `pendiente` warning · `aprobado` success · `rechazado` error. Tipografía: system/Inter. Logo: `/public/logo.fb.png`.

---

## 10. Idioma y localización
Toda la UI, etiquetas, mensajes, correos y errores en español (es-AR). Fechas/números/moneda con locale `es-AR`. Textos en `/lib/copy`.

---

## 11. Skills (en el repo desde Fase 0, ampliadas en fases siguientes)
`new-module` · `purgatorio-form` · `supabase-migration` · `design-system` · `dod-checklist` · `email-notification` (Fase 3). Viven en `.claude/skills/`. Las fases siguientes **reutilizan**; extienden solo si hace falta.

---

## 12. Seguridad (foco de auditoría de Codex)
1. RLS / límite de rol — Empleado solo lo propio; **Supervisor solo su equipo** (`supervisor_id`); verificado en la base.
2. Integridad del purgatorio — nada llega a `aprobado` sin acción de admin.
3. Carga de archivos — validación, control de acceso en Storage, signed URLs.
4. Link de aprobación — requiere auth de admin; no token abierto.
5. Sin secretos en el código.
6. Funciones `SECURITY DEFINER` — guardas internas (nunca desde un parámetro), `search_path` fijo, `REVOKE` explícito de `anon`/`PUBLIC`, owner correcto (ver §6.1); verificado por catálogo post-push. Incluye `log_audit()` (Fase 5): cerrada a `anon`/`authenticated`, invocable solo como helper interno — antes cualquier autenticado podía escribir entradas falsas en `audit_log` vía REST.
7. Gobernanza de `db push` — todo push va por el runbook gateado (§2.3); ningún cambio de esquema en producción sin verificación de catálogo post-push.
8. **Gate de acceso server-side (Fase 5)** — `requireAuth()` solo deja pasar `profiles.status = 'activo'`; una sesión que deja de ser válida a mitad de navegación se corta en el siguiente request, con `signOut()` **antes** del redirect (si no, el JWT sigue técnicamente válido y el middleware genera un loop `/login`↔`/dashboard`). El mensaje que ve un usuario `inactivo` con credencial correcta es **el mismo** que el de credencial inválida — no debe poder distinguir su estado de una contraseña equivocada. La expiración legítima de sesión (sin sesión válida) conserva su copy neutro de siempre, porque ahí no hay nada que filtrar.
9. **Hardening de operaciones admin sobre otros usuarios (Fase 5)** — toda acción que un admin ejecuta sobre el perfil de otro usuario (reseteo de contraseña, baja/alta) revalida ese perfil server-side **después** del guard de rol, trata cero filas afectadas por el `UPDATE` como error (no como éxito silencioso), y **bloquea que un admin se auto-inactive** — si es el único admin, la app queda sin acceso recuperable.

---

## 13. Definición de Done
Criterios del PRD · tests pasando (incluido límite de rol para los 3 roles) · typecheck/lint/build en CI · RLS testeada por tabla · auditoría de Codex limpia · copy es-AR · sin secretos · **migraciones aplicadas y verificadas en producción** (`supabase db push` tras CI verde, por el runbook gateado de §2.3, con verificación de catálogo para funciones `SECURITY DEFINER`).

---

## 14. Pendientes
1. **Flujo de alta:** hoy contraseña inicial por admin; con email ya operativo (§2.4), decidir si se pasa a invitación por correo.
2. **Umbrales y destinatarios de las alertas de vencimiento** (Fase 2).
3. **Listas de Carla:** campos del Google Form de viáticos + Sheet + Drive + mails (Fase 6). *(El ítem de campos de ingreso/precarga quedó sin objeto: el módulo "Ingreso" se descartó en `FB-ADJ-03`, v0.8 — ver §4/§8.)*
4. **Rango de fechas permitido para viáticos** (Carla/Nicolás).
5. **e2e ya cableado en CI (Fase 4):** Playwright corre como tercer job (`E2E Playwright — stack efímero`), junto a typecheck/lint/build y a integración RLS. Queda pendiente que **Luciano marque el check como *required*** en la protección de rama (acción de settings, no de código); estabilizar la performance del runner del stack efímero es un ítem de mejora en el log, no bloqueante.
6. **Parking lot:** Import/Export Excel (cargado en el log de Airtable) — diferido a decisión go/no-go post-MVP.

### Decisiones cerradas (v0.5)
Supabase fuente de verdad · **3 roles con RLS** · `supervisor_id` · pasajes con solicitante + empleado · ausencias nativas · purgatorio con **bandeja única Aprobaciones** · 4 estados de calendario + motivos · empleado y supervisor ven calendario en lectura (supervisor también su equipo) · **auth email + contraseña (admin setea contraseña inicial; sin invitación/magic link/OAuth; primer admin por seed)** · Viáticos externo en Google Workspace · paleta + fondo blanco · español (es-AR) · Gmail · **Visma fuera de alcance (no se usa)** · **deploy en producción adelantado (Vercel, sin staging)** · **nombre unificado en `full_name`** · **retención de documentos rechazados a 30 días** · **gobernanza de migraciones (push a prod tras CI)** · Fases 0 y 1 cerradas.

### Decisiones cerradas (v0.6) — 2026-07-13
**Email operativo:** Gmail API vía service account (`contacto@first-blades.com`, scope `gmail.send`), patrón `notification_log` para idempotencia, mails de flujo best-effort post-commit (skill `email-notification`) · **patrón purgatorio de ausencias:** `ausencia_requests` es el modelo transversal de rango para ausencias, día de trámite el primer tipo (Fase 4 reusa la tabla) · **saldo de días de trámite derivado del calendario** (3/año plano, `es_estimado` cuenta) · **patrón RPC `SECURITY DEFINER`** para transiciones atómicas multi-tabla (§6.1) · **gobernanza de migraciones reforzada:** runbook gateado con verificación de catálogo post-push, ruta sancionada MCP de Supabase (org del cliente), conexión directa a Postgres como excepción gateada, drift detector actualizado intencionalmente · **§5 corregido:** `rotation_assignments` es per-día (`UNIQUE(user_id, fecha)`), no rango; `profiles.dni` existe (`UNIQUE`) · **pintado por rango** en el roster (best-effort por día, `dia_tramite` excluido) · **colores de los 4 estados del calendario confirmados** (§9) · **`rotation_groups` admin-only** · Fases 2 y 3 cerradas.

### Decisiones cerradas (v0.7) — 2026-08-03
**Pasajes con días discretos:** `pasaje_requests.dias_viaje` (`date[]`, CHECK no-vacío) cubre viajes con días sueltos (ej. ida y vuelta con días intermedios sin franco), sin reemplazar la fecha única legacy (`fecha_viaje`); `resolver_pasaje_request` expande cada fecha de `dias_viaje` en `en_viaje` per-día sobre el calendario de `empleado_id` (§5/§6.1) · **no-solapamiento sólo entre pendientes:** exclusion constraint `ausencia_requests_no_solapamiento_pendiente` (`btree_gist`) reemplaza el índice de duplicados exactos; contra aprobadas se permite con alerta de sobrescritura no bloqueante (§5/§6.2) · **edición/cancelación post-aprobación admin-directo:** `cancelar_editar_ausencia_aprobada` / `cancelar_editar_pasaje_aprobado`, comentario obligatorio, guarda LIFO cruzando ausencia/pasaje por `reviewed_at` (§6.1/§6.2) · **`audit_log` de calendario por-día parejo en todo el sistema:** ausencia se alineó a la convención de pasaje (0018) — sin divergencia de granularidad (§6.1) · **contrato return-based de Server Actions:** las actions devuelven `{ ok, error }` en vez de tirar, para no depender de mensajes de `throw` redactados por Next.js en prod (§2.5) · **e2e Playwright cableado como tercer job de CI** (§14) · Fase 4 cerrada.

### Decisiones cerradas (v0.7.1 — FB-ADJ-01/02, ajuste inter-fase) — 2026-08-04
**Renombre de etiqueta:** "Formularios" → "Ingreso" en el menú (sidebar + título de página); ruta (`/formularios`) y contenido "próximamente" sin cambios (§4) · **Admin envía Ausencia/Pasaje para sí:** admin-para-sí solamente (por otros queda fuera de alcance, decisión aparte) — **con migración** (0019, FB-ADJ-02, reemplaza el diseño no-atómico inicial de FB-ADJ-01): dos funciones `SECURITY DEFINER` transaccionales, `crear_aprobar_ausencia_admin`/`crear_aprobar_pasaje_admin`, que insertan la solicitud `pendiente` para el propio admin e invocan por `PERFORM` la resolver existente (`resolver_ausencia_request`/`resolver_pasaje_request`, `p_accion='aprobar'`) **dentro de la misma transacción** — reutilizan su lógica de calendario/`audit_log` sin duplicarla, sin abrir su propia `BEGIN/COMMIT` (corren en la transacción del llamador). **Atómico, sin solicitudes huérfanas:** un fallo en cualquier punto (guarda de admin, exclusion constraint de no-solapamiento, colisión de calendario) revierte todo — la request, el calendario y el audit_log completos, nunca a medias; la Server Action llama a una única RPC, **sin lógica de compensación/borrado** (§4/§6.1/§7) · **excepción explícita a "nada se autoactiva":** admin-para-sí es la única excepción, junto a la ya existente de `uploadDocumentForEmployee` (CLAUDE.md, carga de documentos en nombre del empleado) (§7) · **diálogo de confirmación previo**, solo para admin, antes de enviar.

### Decisiones cerradas (v0.8 — Fase 5 + FB-ADJ-03, ajuste inter-fase) — 2026-08-18
**Módulo Procedimientos / Políticas construido:** `procedures` con columnas en español, `estado` (`procedure_estado`: `vigente`/`archivado`) y CHECK de contenido presente (§5); RLS por estado (no-admin solo `vigente`) y tres RPCs `SECURITY DEFINER` (`crear_procedimiento`/`actualizar_procedimiento`/`archivar_procedimiento`) que escriben `procedures` + `audit_log` atómicamente (§6/§6.1); bucket privado `procedimientos` sin `{userId}` en el path; una pantalla para los tres roles con búsqueda, categoría libre y badge "Nuevo" (§5, Alcance) · **`log_audit()` cerrada:** `EXECUTE` revocado de `anon`/`authenticated`/`PUBLIC` — cerraba un agujero real (cualquier autenticado podía escribir auditoría falsa vía REST) (§5/§6.1/§12) · **Gestión de Usuarios ampliada:** reseteo de contraseña de usuarios existentes (admin client tras verificar admin por sesión, `actor_id` explícito en `audit_log`) y baja con motivo/fecha obligatorios en la app (§2.1/§4/§5) · **Gate de acceso server-side:** solo `activo` entra a `requireAuth()`; `signOut()` antes del redirect; mensaje indistinguible entre `inactivo` y credencial inválida (§12) · **Hardening de operaciones admin-sobre-otro-usuario:** revalidación server-side post-guard, cero filas afectadas tratado como error, auto-inactivación de admin bloqueada (§12) · **Validación de contraseña** (8+ caracteres, número, mayúscula) compartida por alta y reseteo (§2.1) · **Contrato return-based:** errores de PostgREST (`.insert()`/`.update()`) se leen como valor, no los captura un `try/catch` (§2.5) · **`FB-ADJ-03`, ajuste inter-fase:** el cliente descartó el módulo "Ingreso" antes de construirse — eliminado completo (menú, ruta, componentes, copy, tests, docs), no es "próximamente" (§4/§8); `employee_status` quedó en dos valores (`activo`/`inactivo`, migración `0021`) al perder `pendiente` su único caso de uso previsto, sin ninguna dependencia de negocio que recrear (confirmado por `pg_depend` contra producción) (§5) · **Proceso de dos niveles de rigor** para auditoría/merge, acordado con Luciano: ceremonia completa para migraciones, triage del Developer sin re-auditoría para features (§1.1) · **regen de `types.ts` siempre**, incluso ante diffs de infraestructura, para que el diff cero siga siendo señal confiable (§2.3) · Fase 5 cerrada.

### Decisiones cerradas (v0.8.1 — FB-F6-01, Fase 6 en curso) — 2026-08-27
**Ítem de menú Inventario:** nuevo ítem de sidebar, solo admin, ubicado inmediatamente debajo de Rendición de Gastos (§4); placeholder en esta tarea, con el mismo comportamiento no-navegable que Rendición de Gastos hoy — sin URL, `target`, ni configuración de link externo. No es una ruta de la app: no existe `app/inventario/`. El cableado del destino externo real (URL, `target="_blank"`, variable de entorno) queda para `FB-F6-02`. Sin cambios de Supabase (sin migración).
