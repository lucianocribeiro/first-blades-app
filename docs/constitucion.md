# First Blades — Constitución del Portal (v0.6)

> **Estado:** Fases 0, 1, 2 y 3 cerradas. v0.6 incorpora aprendizajes de Fase 3: capa de notificaciones por email (Gmail, service account), patrón purgatorio de ausencias con día de trámite, RPC `SECURITY DEFINER` para transiciones atómicas, gobernanza reforzada de migraciones y `db push`, calendario per-día con pintado por rango, y corrección de §5 (`rotation_assignments`, `profiles.dni`).
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

### 2.2 Contrato de entorno
- `.env.example` commiteado; `.env.local` nunca se sube (gitignored). Secretos solo por variables de entorno.

### 2.3 Despliegue de migraciones (gobernanza)
- **CI valida pero NO aplica** los cambios a la base remota. Tras CI verde, todo cambio de esquema requiere un `supabase db push` **explícito** y **verificación en producción**. Ningún cambio de base de datos está "hecho" hasta aplicarse y verificarse en prod.
- **Auditoría de esquema obligatoria antes del push** de toda migración no trivial (funciones con privilegios, constraints). **Delta-only:** inspeccionar el esquema real primero y escribir solo el delta; nunca asumir que la branch matchea prod.
- **Runbook de push** (gateado por Luciano): pre-push (auditoría de esquema) → push → **verificación de catálogo post-push** (para funciones: `owner` / `prosecdef` / `proconfig` / `proacl`) → `migration list` Local=Remote → regenerar `types.ts --linked`.
- **Hallazgo incorporado (Fase 3):** hubo un push off-script (la migración 0012 llegó a producción fuera del gate). Regla: **todo `db push` va por el runbook gateado**, y Claude Code **reporta cualquier acción que toque producción, aunque sea en otra sesión**.
- **Ruta sancionada de acceso a la base:** MCP de Supabase (apuntada a la org del cliente). La **conexión directa** a Postgres con `SUPABASE_DB_PASSWORD` es una **excepción** —para el push real u operaciones que la MCP no cubra—, gateada y con higiene: solo lectura fuera del push, no imprimir la credencial, borrar scripts temporales.
- **Drift detector** (`migration.test.ts`): inventario exacto (`toEqual`) de enums/tablas/constraints/índices/funciones; para funciones `SECURITY DEFINER` incluye `prosecdef`, `proconfig` (search_path) y owner-consistency. Se actualiza intencionalmente al cambiar el esquema.

### 2.4 Notificaciones por email
- Gmail API vía **service account con domain-wide delegation**, envía como `contacto@first-blades.com`, scope `gmail.send`. Patrón `notification_log` para idempotencia de alertas recurrentes (franco, vencimiento de documentos). Skill `email-notification`.
- **Principio:** toda información que dispara un mail debe tener **representación consultable in-app**; el mail avisa, la app es la fuente de verdad.
- Los mails de flujo (aprobación/rechazo) son **best-effort post-commit**: un fallo de envío no revierte la transacción ni rompe la consistencia; la representación in-app (estado de la solicitud) es la verdad.

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
| Solicitud de Pasaje | (aprueba en Aprobaciones) | Envía para sí y para su equipo | Envía para sí |
| Solicitud de Ausencia (Período fuera del trabajo) | (aprueba en Aprobaciones) | Envía para sí | Envía para sí |
| Carga de Documentos | Carga + (aprueba en Aprobaciones) | Envía propios (→ Pendiente) | Envía propios (→ Pendiente) |
| **Aprobaciones** | **Bandeja única: pasajes, ausencias, documentos, onboarding** | — | — |
| Gestión (usuarios) | Crea usuarios, asigna rol + supervisor | — | — |
| Formularios (ingreso / precarga) | Ve formularios recibidos | Acceso al formulario de ingreso | Acceso al formulario de ingreso |
| Rendición de Gastos (Google Form, externo) | Revisa (en Sheets) | Carga comprobantes (link) | Carga comprobantes (link) |
| Procedimientos / Políticas | Gestiona documentos | Lectura | Lectura |

Notas:
- **Supervisor = capacidades de Empleado + pide pasajes para su equipo + ve el calendario de su equipo (lectura).** No accede a administración de calendario, ni a Equipo completo, ni a Gestión, ni a Aprobaciones.
- "Empleados a cargo" se define por `supervisor_id` en `profiles`.
- Empleado y Supervisor **nunca** editan su perfil directamente: todo cambio pasa por formularios → Pendiente → Aprobaciones (admin).
- Permisos aplicados a **nivel de base de datos vía RLS**, no solo en la UI.

---

## 5. Modelo de datos (Supabase / Postgres)

Enums:
- `employee_status`: `activo` | `inactivo` | `pendiente`
- `approval_status`: `pendiente` | `aprobado` | `rechazado`
- `user_role`: `admin` | `supervisor` | `empleado`
- `estado_dia` (calendario): `trabajando` | `en_viaje` | `en_franco` | `periodo_fuera_trabajo`
- `motivo_ausencia`: `vacaciones` | `licencia_medica` | `dia_tramite` | `matrimonio` | `fallecimiento` | `otros`
- `motivo_viaje` (pasaje): `inicio_franco` | `fin_franco` | `traslado_proyectos`

### `profiles`
`id` (uuid, FK auth.users) · `role` (user_role) · `estado` (employee_status) · `supervisor_id` (uuid, FK profiles, nullable) · `full_name` · `email` (login) · `telefono` · `cuit` · `dni` (text, **UNIQUE**, nullable — clave de import de historial) · `winda_id` · `entrevista_tecnica` (jsonb, **solo admin**) · `created_at` · `updated_at`

### `documents` — tabla unificada de purgatorio
`id` · `profile_id` · `tipo` (`dni` | `licencia` | `foto_carnet` | `estudio_medico` | `certificado`) · `certificado_tipo` (`gwo` | `espacio_confinado` | `manejo_defensivo` | `otros`, nullable) · `certificado_otros_texto` (varchar 30, nullable) · `file_path` · `fecha_vencimiento` (nullable) · `estado` (approval_status) · `motivo_rechazo` (nullable) · `submitted_by` · `reviewed_by` · `submitted_at` · `reviewed_at`
> **Retención:** los documentos rechazados se purgan a los 30 días (se borra el archivo en Storage; se conserva el registro).

### `pasaje_requests`
`id` · `solicitante_id` · `empleado_id` · `motivo_viaje` · `detalle` (jsonb) · `estado` · `motivo_rechazo` · `reviewed_by` · `submitted_at` · `reviewed_at`

### `ausencia_requests`
`id` · `profile_id` · `motivo` (motivo_ausencia) · `motivo_otros_texto` (nullable) · `fecha_inicio` · `fecha_fin` · `estado` · `motivo_rechazo` · `reviewed_by` · `submitted_at` · `reviewed_at`
> Al aprobarse, genera el estado `periodo_fuera_trabajo` en el calendario con su motivo (ver §6.1 para el patrón RPC que ejecuta esta transición). Es el **patrón transversal** solicitud→aprobación para ausencias — **día de trámite es el primer tipo** que lo usa (Fase 4 reusa la tabla para los demás motivos). **Modelo de rango** (`fecha_inicio`/`fecha_fin`); para un día puntual, inicio = fin — no confundir con `rotation_assignments`, que es per-día.
>
> Invariantes: no-admin inserta solo lo propio + `estado='pendiente'` (policy `ausencias_insert_non_admin`); ningún no-admin modifica `estado`; toda transición se registra en `audit_log`; el rechazo exige motivo. La capa de app **superpone scope de negocio a la RLS**: la cola de aprobación filtra por motivo + estado, y la action **revalida el scope server-side** (`estado='pendiente'` + `motivo_ausencia='dia_tramite'`) antes de resolver — la RLS y la guarda de la RPC no limitan el motivo por diseño.
>
> **Saldo de días de trámite** — derivado del calendario, sin tabla ni contador propio: consumidos = filas `dia_tramite` del año calendario (`getBusinessToday`, zona `America/Argentina/Buenos_Aires`); restantes = `3 − consumidos`; tope **3/año plano, no acumulable**; excedido cuando `> 3`; alerta no bloqueante, consultable in-app, sin importar el camino de carga (roster admin o solicitud aprobada). **`es_estimado` SÍ cuenta** para este saldo — regla explícita, no copiar por analogía la lógica de otras alertas del calendario donde un día estimado no cuenta.

### `rotation_groups` · `rotation_assignments`
> **Corrige v0.5:** `rotation_assignments` es **per-día** (una fila por `(user_id, fecha)`), no modelo de rango — v0.5 anticipaba `fecha_inicio`/`fecha_fin`, pero eso no matcheó lo construido. No confundir con `ausencia_requests`, que sí es un modelo de rango.

`rotation_assignments`: `id` · `user_id` (FK profiles) · `fecha` · `estado_dia` · `es_estimado` (bool) · `motivo_ausencia` (nullable, requerido si `periodo_fuera_trabajo`) · `motivo_otros_texto` (nullable) · `rotation_group_id` (nullable, FK rotation_groups) · `notas` · `created_at` · `updated_at`. **`UNIQUE(user_id, fecha)`.**
> `es_estimado` → `false` (real) vía cron nocturno cuando `fecha <= hoy + 7`; "hoy" siempre en zona `America/Argentina/Buenos_Aires` (`getBusinessToday`), nunca UTC crudo.
>
> **Pintado por rango:** el admin edita un rango de fechas consecutivas para **una fila** (un `user_id`) de una sola vez. Escritura **best-effort**: un fallo por día no aborta el resto, se reporta cada día fallido con motivo legible; reintentar es seguro (upsert idempotente). `es_estimado` se recalcula por fecha. **`dia_tramite` queda excluido** del pintado por rango — se carga solo por su flujo de solicitud/aprobación (ver `ausencia_requests` arriba), para no saltear el purgatorio ni descuadrar el saldo. Gesto: click simple edita un día; shift-click fija el ancla del rango **sin abrir ningún modal**; el segundo shift-click en la misma fila abre el modal de rango.
>
> `rotation_groups` es **admin-only** (sin `SELECT` para no-admin) — tabla inerte en Fase 3, sin UI ni consumidor de grupos.

### `procedures` · `audit_log`
(Viáticos no tiene tabla en Supabase: vive en Google Workspace.)

### Alcance del módulo Calendario (Fase 2) — documentado
Alertas (48/60 días sin franco; 10–12 días de franco; solo admin, informativas) · días de trámite (3/año, no acumulables, historial por empleado) · reglas de viaje (>12 h = día de viaje; `motivo_viaje` actualiza calendario) · vista roster (mensual, por rango, futuros "estimados") · carga de 60 días de historial pre-lanzamiento.

### Alcance de Viáticos (Fase 3) — externo
Google Form → Drive → Sheets → Apps Script (Carla revisa, mails por cambio de estado). Backlog: análisis de facturas con IA + dashboard.

---

## 6. Modelo RLS

- **profiles:** Empleado/Supervisor `SELECT` su fila; Supervisor además `SELECT` su equipo (`supervisor_id = auth.uid()`); sin `UPDATE`. Admin completo.
- **documents:** Empleado/Supervisor `SELECT`/`INSERT` propios (estado forzado `pendiente`, sin cambiar `estado`); Admin completo.
- **pasaje_requests:** Empleado `INSERT`/`SELECT` propios; Supervisor para/de su equipo; Admin completo.
- **ausencia_requests:** Empleado/Supervisor `INSERT`/`SELECT` propios; Admin completo.
- **rotation_assignments:** Empleado `SELECT` su calendario; Supervisor su calendario + el de su equipo; sin escritura. Admin completo. **rotation_groups** es **admin-only** (sin `SELECT` para no-admin).
- **procedures:** Empleado/Supervisor solo `SELECT`; Admin completo.

### 6.1 Patrón RPC `SECURITY DEFINER` para transiciones atómicas
- Cuando una transición escribe en varias tablas todo-o-nada (ej. `resolver_ausencia_request`: estado + `audit_log` + calendario), va en una **función Postgres invocada con `.rpc()`**, no en escrituras secuenciales del cliente (que no dan transacción).
- Reglas de la función: `SECURITY DEFINER` con **`search_path` fijo explícito**; las **guardas internas son el control de seguridad principal** (admin chequeado contra `auth.uid()`, tratando **NULL como no-admin**, nunca desde un parámetro; estado `pendiente` con `SELECT ... FOR UPDATE` para serializar); `EXECUTE` solo a `authenticated`, con **`REVOKE` explícito de `anon`** (Supabase lo re-otorga por default) y de `PUBLIC`; **owner** de la función = rol de administración (no un rol de app), verificado por catálogo post-push (ver §2.3).
- Las actions invocan la RPC con **`createServerClient()`**, NO `createAdminClient()`: `service_role` no tiene `sub` en el JWT y la guarda `auth.uid()` abortaría siempre.

---

## 7. Patrón Purgatorio (transversal — app)

Aplica a: documentos de perfil, onboarding/precarga, solicitudes de pasaje y solicitudes de ausencia.

```
Empleado/Supervisor envía (formulario nativo)
   → registro con estado = pendiente   (nada se autoactiva)
   → entra a la bandeja única Aprobaciones (solo admin)
   → Admin aprueba (aplica efecto) / rechaza (+ motivo → se notifica para corregir)
```
> Todas las solicitudes confluyen en **una sola bandeja Aprobaciones**, no se aprueban dentro de cada módulo. **Viáticos NO usa este patrón** (vive en Google Sheets).

---

## 8. Ciclo de vida del empleado y onboarding

- Estados: **Activo** (aprobado, acceso completo), **Pendiente** (en evaluación / documentación sin auditar), **Inactivo** (desvinculado o sin apto médico; historial preservado).
- **Precarga:** link externo (sin cuenta activa) para que candidatos suban documentación → `pendiente` → admin aprueba → `activo`.

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
6. Funciones `SECURITY DEFINER` — guardas internas (nunca desde un parámetro), `search_path` fijo, `REVOKE` explícito de `anon`/`PUBLIC`, owner correcto (ver §6.1); verificado por catálogo post-push.
7. Gobernanza de `db push` — todo push va por el runbook gateado (§2.3); ningún cambio de esquema en producción sin verificación de catálogo post-push.

---

## 13. Definición de Done
Criterios del PRD · tests pasando (incluido límite de rol para los 3 roles) · typecheck/lint/build en CI · RLS testeada por tabla · auditoría de Codex limpia · copy es-AR · sin secretos · **migraciones aplicadas y verificadas en producción** (`supabase db push` tras CI verde, por el runbook gateado de §2.3, con verificación de catálogo para funciones `SECURITY DEFINER`).

---

## 14. Pendientes
1. **Flujo de alta:** hoy contraseña inicial por admin; con email ya operativo (§2.4), decidir si se pasa a invitación por correo.
2. **Umbrales y destinatarios de las alertas de vencimiento** (Fase 2).
3. **Listas de Carla:** campos de ingreso/precarga; campos del Google Form de viáticos + Sheet + Drive + mails (Fase 6).
4. **Rango de fechas permitido para viáticos** (Carla/Nicolás).
5. **e2e fuera de la compuerta de CI:** solo corren unit + integración RLS; Playwright no está wireado a ningún workflow. Bugs de interacción real de browser (ej. inertización de `<dialog>.showModal()`) no tienen compuerta automática — se cubren con guards RTL puntuales. Deuda a evaluar.
6. **Parking lot:** Import/Export Excel (cargado en el log de Airtable) — diferido a decisión go/no-go post-MVP.

### Decisiones cerradas (v0.5)
Supabase fuente de verdad · **3 roles con RLS** · `supervisor_id` · pasajes con solicitante + empleado · ausencias nativas · purgatorio con **bandeja única Aprobaciones** · 4 estados de calendario + motivos · empleado y supervisor ven calendario en lectura (supervisor también su equipo) · **auth email + contraseña (admin setea contraseña inicial; sin invitación/magic link/OAuth; primer admin por seed)** · Viáticos externo en Google Workspace · paleta + fondo blanco · español (es-AR) · Gmail · **Visma fuera de alcance (no se usa)** · **deploy en producción adelantado (Vercel, sin staging)** · **nombre unificado en `full_name`** · **retención de documentos rechazados a 30 días** · **gobernanza de migraciones (push a prod tras CI)** · Fases 0 y 1 cerradas.

### Decisiones cerradas (v0.6) — 2026-07-13
**Email operativo:** Gmail API vía service account (`contacto@first-blades.com`, scope `gmail.send`), patrón `notification_log` para idempotencia, mails de flujo best-effort post-commit (skill `email-notification`) · **patrón purgatorio de ausencias:** `ausencia_requests` es el modelo transversal de rango para ausencias, día de trámite el primer tipo (Fase 4 reusa la tabla) · **saldo de días de trámite derivado del calendario** (3/año plano, `es_estimado` cuenta) · **patrón RPC `SECURITY DEFINER`** para transiciones atómicas multi-tabla (§6.1) · **gobernanza de migraciones reforzada:** runbook gateado con verificación de catálogo post-push, ruta sancionada MCP de Supabase (org del cliente), conexión directa a Postgres como excepción gateada, drift detector actualizado intencionalmente · **§5 corregido:** `rotation_assignments` es per-día (`UNIQUE(user_id, fecha)`), no rango; `profiles.dni` existe (`UNIQUE`) · **pintado por rango** en el roster (best-effort por día, `dia_tramite` excluido) · **colores de los 4 estados del calendario confirmados** (§9) · **`rotation_groups` admin-only** · Fases 2 y 3 cerradas.
