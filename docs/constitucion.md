# First Blades — Constitución del Portal (v0.5)

> **Estado:** Fases 0 y 1 cerradas. v0.5 incorpora aprendizajes de Fase 1: gobernanza de despliegue de migraciones, deploy adelantado a producción, nombre unificado (`full_name`) y retención de documentos.
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
- **Notificaciones (app):** Gmail (dirección a proveer) — mails a quien aprueba (pasajes y ausencias).
- **Viáticos / Rendición de Gastos: externo en Google Workspace** — Google Form → Drive → Sheets → Apps Script. Se accede por **link** desde la app. No usa n8n.

### 2.1 Autenticación
- **Email + contraseña.** El admin crea el usuario con una **contraseña inicial** desde Gestión de Usuarios. Sin mail de invitación, sin magic link, sin OAuth.
- El **primer admin** se siembra por seed (`FIRST_ADMIN_EMAIL`). Esto deja la app sin dependencia de email para arrancar.

### 2.2 Contrato de entorno
- `.env.example` commiteado; `.env.local` nunca se sube (gitignored). Secretos solo por variables de entorno.

### 2.3 Despliegue de migraciones (gobernanza)
- **CI valida pero NO aplica** los cambios a la base remota. Tras CI verde, todo cambio de esquema requiere un `supabase db push` **explícito** y **verificación en producción**. Ningún cambio de base de datos está "hecho" hasta aplicarse y verificarse en prod.

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
`id` (uuid, FK auth.users) · `role` (user_role) · `estado` (employee_status) · `supervisor_id` (uuid, FK profiles, nullable) · `full_name` · `email` (login) · `telefono` · `cuit` · `winda_id` · `entrevista_tecnica` (jsonb, **solo admin**) · `created_at` · `updated_at`

### `documents` — tabla unificada de purgatorio
`id` · `profile_id` · `tipo` (`dni` | `licencia` | `foto_carnet` | `estudio_medico` | `certificado`) · `certificado_tipo` (`gwo` | `espacio_confinado` | `manejo_defensivo` | `otros`, nullable) · `certificado_otros_texto` (varchar 30, nullable) · `file_path` · `fecha_vencimiento` (nullable) · `estado` (approval_status) · `motivo_rechazo` (nullable) · `submitted_by` · `reviewed_by` · `submitted_at` · `reviewed_at`
> **Retención:** los documentos rechazados se purgan a los 30 días (se borra el archivo en Storage; se conserva el registro).

### `pasaje_requests`
`id` · `solicitante_id` · `empleado_id` · `motivo_viaje` · `detalle` (jsonb) · `estado` · `motivo_rechazo` · `reviewed_by` · `submitted_at` · `reviewed_at`

### `ausencia_requests`
`id` · `profile_id` · `motivo` (motivo_ausencia) · `motivo_otros_texto` (nullable) · `fecha_inicio` · `fecha_fin` · `estado` · `motivo_rechazo` · `reviewed_by` · `submitted_at` · `reviewed_at`
> Al aprobarse, genera el estado `periodo_fuera_trabajo` en el calendario con su motivo.

### `rotation_groups` · `rotation_assignments`
`rotation_assignments`: `id` · `profile_id` · `group_id` · `fecha_inicio` · `fecha_fin` · `estado_dia` · `motivo_ausencia` (nullable, requerido si `periodo_fuera_trabajo`) · `motivo_otros_texto` (nullable). Cadencia mensual; detalle en Fase 2.

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
- **rotation_*:** Empleado `SELECT` su calendario; Supervisor su calendario + el de su equipo; sin escritura. Admin completo.
- **procedures:** Empleado/Supervisor solo `SELECT`; Admin completo.

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
Estados del calendario (propuestos, confirmar en Fase 2): `trabajando #2E7D32` · `en_viaje #F9A825` · `en_franco #607D8B` · `periodo_fuera_trabajo #C62828`.
Badges: `pendiente` warning · `aprobado` success · `rechazado` error. Tipografía: system/Inter. Logo: `/public/logo.fb.png`.

---

## 10. Idioma y localización
Toda la UI, etiquetas, mensajes, correos y errores en español (es-AR). Fechas/números/moneda con locale `es-AR`. Textos en `/lib/copy`.

---

## 11. Skills (en el repo desde Fase 0)
`new-module` · `purgatorio-form` · `supabase-migration` · `design-system` · `dod-checklist`. Viven en `.claude/skills/`. Las fases siguientes **reutilizan**; extienden solo si hace falta.

---

## 12. Seguridad (foco de auditoría de Codex)
1. RLS / límite de rol — Empleado solo lo propio; **Supervisor solo su equipo** (`supervisor_id`); verificado en la base.
2. Integridad del purgatorio — nada llega a `aprobado` sin acción de admin.
3. Carga de archivos — validación, control de acceso en Storage, signed URLs.
4. Link de aprobación — requiere auth de admin; no token abierto.
5. Sin secretos en el código.

---

## 13. Definición de Done
Criterios del PRD · tests pasando (incluido límite de rol para los 3 roles) · typecheck/lint/build en CI · RLS testeada por tabla · auditoría de Codex limpia · copy es-AR · sin secretos · **migraciones aplicadas y verificadas en producción** (`supabase db push` tras CI verde).

---

## 14. Pendientes
1. **Dirección de Gmail** para notificaciones (se confirma al developer de Fase 2).
2. **Flujo de alta:** hoy contraseña inicial por admin; al configurar email (Fase 2), decidir si se pasa a invitación por correo.
3. **Umbrales y destinatarios de las alertas de vencimiento** (Fase 2).
4. **Colores de los 4 estados del calendario** (§9) — confirmar en Fase 3.
5. **Listas de Carla:** campos de ingreso/precarga; campos del Google Form de viáticos + Sheet + Drive + mails (Fase 6).
6. **Rango de fechas permitido para viáticos** (Carla/Nicolás).

### Decisiones cerradas (v0.5)
Supabase fuente de verdad · **3 roles con RLS** · `supervisor_id` · pasajes con solicitante + empleado · ausencias nativas · purgatorio con **bandeja única Aprobaciones** · 4 estados de calendario + motivos · empleado y supervisor ven calendario en lectura (supervisor también su equipo) · **auth email + contraseña (admin setea contraseña inicial; sin invitación/magic link/OAuth; primer admin por seed)** · Viáticos externo en Google Workspace · paleta + fondo blanco · español (es-AR) · Gmail · **Visma fuera de alcance (no se usa)** · **deploy en producción adelantado (Vercel, sin staging)** · **nombre unificado en `full_name`** · **retención de documentos rechazados a 30 días** · **gobernanza de migraciones (push a prod tras CI)** · Fases 0 y 1 cerradas.
