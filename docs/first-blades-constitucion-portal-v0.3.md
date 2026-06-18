# First Blades — Constitución del Portal (v0.3)

> **Estado:** Adjudicado por Luciano. v0.3 incorpora el acta del 11/06 (Sprint 1): tercer rol Supervisor, estados del calendario, Rendición por Google Workspace, y lectura de calendario para empleado/supervisor.
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
- **Fuente de verdad:** Supabase — Postgres, Auth, Storage, Row-Level Security.
- **Hosting:** Vercel (deploy productivo, dominio propio, SSL, variables de entorno).
- **Notificaciones (app):** Gmail (dirección a proveer) — mails a quien aprueba (pasajes y ausencias).
- **Viáticos / Rendición de Gastos: externo en Google Workspace** — Google Form → Drive → Sheets → Apps Script. Se accede por **link** desde la app. **No usa n8n.**
- **Fuera de alcance v1:** integración con Visma (fase 2, post-lanzamiento).

---

## 3. Estructura del repositorio (propuesta)

```
/app                 # rutas (App Router), sensibles al rol
/components          # UI compartida (sobre el sistema de diseño)
/lib                 # cliente supabase, helpers de auth, utils
/lib/copy            # textos de UI centralizados en español (es-AR)
/supabase/migrations # migraciones de esquema versionadas
/public              # logo.fb.png + assets estáticos
/tests               # tests unitarios + de integración
/.claude/skills      # skills de build reutilizables
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
| Solicitud de Pasaje | Aprueba / rechaza | Envía para sí y para su equipo | Envía para sí |
| Solicitud de Ausencia (Período fuera del trabajo) | Aprueba / rechaza | Envía para sí | Envía para sí |
| Carga de Documentos | Aprueba / rechaza / carga | Envía propios (→ Pendiente) | Envía propios (→ Pendiente) |
| Gestión (usuarios) | Crea usuarios, asigna rol | — | — |
| Formularios (ingreso / precarga) | Ve formularios recibidos | Acceso al formulario de ingreso | Acceso al formulario de ingreso |
| Rendición de Gastos (Google Form, externo) | Revisa (en Sheets) | Carga comprobantes (link) | Carga comprobantes (link) |
| Procedimientos / Políticas | Gestiona documentos | Lectura | Lectura |

Notas:
- **Supervisor = capacidades de Empleado + pide pasajes para los empleados a su cargo + ve el calendario de su equipo (lectura).** No accede a administración de calendario, ni a Equipo completo, ni a Gestión.
- "Empleados a cargo" se define por `supervisor_id` en `profiles`.
- Empleado y Supervisor **nunca** editan su perfil directamente: todo cambio pasa por formularios → Pendiente → admin aprueba.
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

### `profiles` — una fila por empleado, vinculada a `auth.users`
`id` (uuid, FK auth.users) · `role` (user_role) · `estado` (employee_status) · **`supervisor_id`** (uuid, FK profiles, nullable — supervisor asignado) · `nombre` · `apellido` · `email` (login) · `telefono` · `cuit` · `winda_id` · `entrevista_tecnica` (jsonb, **solo admin**) · `created_at` · `updated_at`

### `documents` — tabla unificada de purgatorio para todo archivo cargado
`id` · `profile_id` (FK) · `tipo` (`dni` | `licencia` | `foto_carnet` | `estudio_medico` | `certificado`) · `certificado_tipo` (`gwo` | `espacio_confinado` | `manejo_defensivo` | `otros`, nullable) · `certificado_otros_texto` (varchar 30, nullable) · `file_path` · `fecha_vencimiento` (nullable) · `estado` (approval_status) · `motivo_rechazo` (nullable) · `submitted_by` · `reviewed_by` · `submitted_at` · `reviewed_at`

### `pasaje_requests`
`id` · **`solicitante_id`** (quién pide: empleado o supervisor) · **`empleado_id`** (para quién es el pasaje) · `motivo_viaje` (motivo_viaje) · `detalle` (jsonb: origen, destino, fecha) · `estado` (approval_status) · `motivo_rechazo` (nullable) · `reviewed_by` · `submitted_at` · `reviewed_at`

### `ausencia_requests` — solicitud de Período fuera del trabajo (nativa)
`id` · `profile_id` (solicitante) · `motivo` (motivo_ausencia) · `motivo_otros_texto` (varchar, nullable) · `fecha_inicio` · `fecha_fin` · `estado` (approval_status) · `motivo_rechazo` (nullable) · `reviewed_by` · `submitted_at` · `reviewed_at`
> Al aprobarse, genera el estado `periodo_fuera_trabajo` en el calendario con su motivo.

### `rotation_groups` · `rotation_assignments`
`rotation_assignments`: `id` · `profile_id` · `group_id` (FK) · `fecha_inicio` · `fecha_fin` · `estado_dia` (enum 4 estados) · `motivo_ausencia` (nullable, requerido si `estado_dia = periodo_fuera_trabajo`) · `motivo_otros_texto` (nullable)
> Cadencia mensual. El detalle del módulo se define en su propio chat (Fase 2).

### `procedures` · `audit_log`
(Viáticos no tiene tabla en Supabase: vive en Google Workspace.)

### Alcance del módulo Calendario (Fase 2) — documentado, no se construye en Fase 0
- **Alertas no decisionales (solo admin):** 48 y 60 días trabajados sin franco; 10–12 días de franco corridos. Informativas; no modifican el calendario.
- **Días de trámite:** 3 por año calendario, no acumulables, con anticipación y aprobación; historial de consumo por empleado (se deriva de registros con motivo `dia_tramite`).
- **Reglas de viaje:** viaje >12 h = "día de viaje" (no cuenta franco ni trabajo); el `motivo_viaje` del pasaje actualiza el calendario en una iteración posterior.
- **Vista roster:** mensual, por rango (3–6 meses), futuros marcados como "estimados"; días = columnas, empleados = filas.
- **Carga de 60 días de historial** antes del lanzamiento (para habilitar alertas desde el día 1).

### Alcance de Viáticos (Fase 3) — externo, documentado
Google Form (nombre, documento, fecha del gasto, concepto, monto, adjunto) → adjunto a Drive (estructura año/mes) → fila en Sheets con estado Pendiente → Carla revisa y cambia estado → Apps Script dispara mail al empleado (+ a Nicolás al aprobar). Estados: Pendiente/Aprobado/Rechazado. Restricción de fechas (rango a definir por Carla/Nicolás). Backlog: análisis de facturas con IA (Claude) + dashboard.

---

## 6. Modelo RLS (aplicado en la base de datos)

- **profiles:** Empleado/Supervisor `SELECT` su fila; el Supervisor además `SELECT` las filas de su equipo (`supervisor_id = auth.uid()`); sin `UPDATE`. Admin completo.
- **documents:** Empleado/Supervisor `SELECT`/`INSERT` propios (estado forzado `pendiente`, sin cambiar `estado`); Admin completo.
- **pasaje_requests:** Empleado `INSERT`/`SELECT` donde es solicitante o empleado; Supervisor `INSERT` para sí o su equipo y `SELECT` propios + de su equipo; Admin completo (aprobar).
- **ausencia_requests:** Empleado/Supervisor `INSERT`/`SELECT` propios; Admin completo.
- **rotation_*:** Empleado `SELECT` su propio calendario; Supervisor `SELECT` su calendario + el de su equipo; sin escritura. Admin completo.
- **procedures:** Empleado/Supervisor solo `SELECT`; Admin completo.

---

## 7. Patrón Purgatorio (transversal — app)

Aplica a: documentos de perfil, onboarding/precarga, **solicitudes de pasaje** y **solicitudes de ausencia**.

```
Empleado/Supervisor envía (formulario nativo)
   → registro con estado = pendiente   (nada se autoactiva)
   → mail al aprobador (admin)
   → Admin revisa → Aprobado (aplica efecto) / Rechazado (+ motivo → se notifica para corregir)
```
> **Viáticos NO usa este patrón:** su aprobación vive en Google Sheets (externo).

---

## 8. Ciclo de vida del empleado y onboarding

- Estados: **Activo** (aprobado, acceso completo), **Pendiente** (en evaluación / documentación sin auditar), **Inactivo** (desvinculado o sin apto médico; historial preservado).
- **Precarga:** link externo (sin cuenta activa) para que candidatos suban documentación → queda `pendiente` → admin aprueba → `activo`.

---

## 9. Sistema de diseño

**Tokens de marca (confirmados):**
`--color-primary #0D7EC7` · `--color-secondary #003E68` · `--color-neutral #666666` · `--color-bg #FFFFFF` (blanco)
Soporte: `--color-surface #F4F6F8` · `--color-border #E2E8F0` · `--color-success #2E7D32` · `--color-error #C62828` · `--color-warning #F9A825`

**Colores de los 4 estados del calendario (propuestos, confirmar en Fase 2):**
`trabajando #2E7D32 (verde)` · `en_viaje #F9A825 (amarillo)` · `en_franco #607D8B (azul-gris)` · `periodo_fuera_trabajo #C62828 (rojo)`

**Badges de aprobación:** `pendiente` warning · `aprobado` success · `rechazado` error
**Tipografía:** system/Inter por defecto. **Logo:** `/public/logo.fb.png`.

---

## 10. Idioma y localización

- **Toda la UI, etiquetas, mensajes, correos y errores en español (es-AR).**
- Fechas/números/moneda con locale `es-AR`. Textos centralizados en `/lib/copy`.

---

## 11. Skills a construir (Fase 0)

- **new-module** · **purgatorio-form** (cubre pasajes y ausencias) · **supabase-migration** · **design-system** · **dod-checklist**.

---

## 12. Seguridad (foco de auditoría de Codex)

1. **RLS / límite de rol** — Empleado solo sus datos; **Supervisor solo su equipo (vía `supervisor_id`)**, nunca empleados fuera de su cargo ni funciones de admin; verificado en la base, no en la UI.
2. **Integridad del purgatorio** — nada llega a `aprobado` sin acción de admin.
3. **Carga de archivos** — validación, control de acceso en Storage, signed URLs.
4. **Link de aprobación de pasaje/ausencia** — debe requerir auth de admin; no un token abierto.
5. **Sin secretos** en el código.

---

## 13. Definición de Done (la compuerta)

Criterios del PRD cumplidos · tests pasando (incluido test de límite de rol para los 3 roles) · typecheck/lint/build en CI · RLS testeada por tabla · auditoría de Codex limpia · copy en español (es-AR) · sin secretos.

---

## 14. Pendientes

1. **Dirección de Gmail** para notificaciones.
2. **Colores de los 4 estados del calendario** (§9) — confirmar en el chat de Calendario (Fase 2).
3. **Listas de Carla:** campos de ingreso/precarga (Fase 1); campos del Google Form de viáticos + estructura del Sheet + carpeta Drive + textos de mails (Fase 3).
4. **Rango de fechas permitido para viáticos** (Carla/Nicolás).
5. **Método de auth y email del primer admin** — se confirman al arrancar Fase 0 (ver PRD).

### Decisiones cerradas (v0.3)
Supabase fuente de verdad · **3 roles (Admin/Supervisor/Empleado)** con RLS · `supervisor_id` en profiles · pasajes con solicitante + empleado · **ausencias nativas** · purgatorio para pasajes/ausencias/docs/onboarding · **4 estados de calendario + motivos** · empleado y supervisor ven calendario en lectura (supervisor también el de su equipo) · **Viáticos externo en Google Workspace (reemplaza n8n)** · paleta + fondo blanco · español (es-AR) · Gmail · Visma fase 2.
