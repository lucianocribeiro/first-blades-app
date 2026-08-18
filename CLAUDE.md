# CLAUDE.md — Portal First Blades

Contexto operativo para Claude Code. Construí **según** la constitución (`/docs/constitucion.md`) y el PRD de la fase activa (`/docs/`). Codex audita **contra** esos documentos. Ante conflicto entre este archivo y la constitución, **gana la constitución**.

## Qué es

Portal/intranet interno de First Blades para un equipo de operaciones de campo (técnicos de palas eólicas). Aplicación nativa Next.js. Todo el producto en **español (es-AR)**.

## Stack (fijo)

- **Next.js** (App Router) + **TypeScript** (strict).
- **Supabase**: Postgres, Auth, Storage, Row-Level Security. Es la fuente de verdad.
- **Tailwind** con los tokens del sistema de diseño (ver skill `design-system`).
- **Hosting**: Vercel (deploy productivo es Fase 4).
- **Tests**: Vitest (unit/integración) + Playwright (e2e). **CI**: GitHub Actions.
- **Notificaciones (app)**: Gmail (dirección por env, pendiente).
- **Viáticos / Rendición de Gastos**: externo en Google Workspace, se accede por **link**. No vive en la app, no usa n8n, no tiene tabla en Supabase.
- Fuera de alcance v1: integración con Visma (Fase 2).

## Estructura del repo

```
/app                 # rutas (App Router), sensibles al rol
/components          # UI compartida (sobre el sistema de diseño)
/lib                 # cliente supabase, helpers de auth, utils
/lib/copy            # textos de UI centralizados en español (es-AR)
/supabase/migrations # migraciones de esquema versionadas
/public              # logo.fb.png + assets
/tests               # unit + integración + e2e
/.claude/skills      # skills de build reutilizables (no recrear: reutilizar/extender)
/docs                # constitución + PRDs por módulo
CLAUDE.md            # este archivo
```

## Roles (3) y autoridad

- `admin` (Administrador), `supervisor` (Supervisor), `empleado` (Empleado).
- "Empleados a cargo" del supervisor se definen por `profiles.supervisor_id`.
- **La autoridad de permisos vive en la base de datos (RLS), no en la UI.** Ocultar en la UI no alcanza: toda tabla tiene RLS por rol, incluida la lógica de equipo del supervisor (`supervisor_id = auth.uid()`).
- Empleado y supervisor **nunca** editan su perfil directamente: todo cambio pasa por formulario → Pendiente → admin aprueba.

## Patrón Purgatorio (transversal)

Aplica a documentos, onboarding/precarga, solicitudes de pasaje y de ausencia.

```
Empleado/Supervisor envía (formulario nativo)
  → registro con estado = pendiente   (NADA se autoactiva)
  → notificación al aprobador (admin)
  → Admin aprueba (aplica efecto) / rechaza (+ motivo → se notifica para corregir)
```

Invariante: nada llega a `aprobado` sin acción explícita de un admin. Ver skill `purgatorio-form`. Viáticos NO usa este patrón (es externo).

**Excepciones deliberadas — dos paths de auto-aprobación:**
1. **(A5)** `uploadDocumentForEmployee` (carga admin en nombre del empleado) crea el documento directamente en `aprobado`. El admin ya está aprobando implícitamente al cargar. Fijado con tests en `mi-perfil.test.ts` → describe `excepción A5`.
2. **(FB-ADJ-01) Admin-para-sí:** una Solicitud de Ausencia o de Pasaje que un admin envía **para sí mismo** se auto-aprueba al enviarla (con diálogo de confirmación previo) — no pasa por Aprobaciones. Ver constitución (`docs/constitucion.md` v0.7.1) §4 y la excepción explícita al principio "nada se autoactiva".

Todo lo demás (submission de empleado o supervisor, y cualquier solicitud de un admin para otra persona) entra en `pendiente` sin excepción.

## Menú (sidebar, ítems visibles según rol)

Sidebar colapsable con hamburguesa. Ítems y visibilidad:

| Ítem | admin | supervisor | empleado |
|---|---|---|---|
| Mi Perfil (incluye Carga de Documentos) | ✓ | ✓ | ✓ |
| Equipo | ✓ | — | — |
| Calendario | ✓ | ✓ (propio + equipo, lectura) | ✓ (propio, lectura) |
| Solicitud de Pasaje | ✓ (envía **para sí**, auto-aprobado) | ✓ (envía sí + equipo) | ✓ (envía sí) |
| Solicitud de Ausencia | ✓ (envía **para sí**, auto-aprobado) | ✓ (envía) | ✓ (envía) |
| Aprobaciones (bandeja única de purgatorio) | ✓ | — | — |
| Procedimientos / Políticas | ✓ (gestiona) | ✓ (lee) | ✓ (lee) |
| Rendición de Gastos (externo, link) | ✓ | ✓ | ✓ |
| Gestión de Usuarios | ✓ | — | — |

- El admin **ve todos los ítems** del menú. En Solicitud de Pasaje/Ausencia **envía para sí mismo** (admin-para-sí solamente, auto-aprobado — ver excepción A5/FB-ADJ-01 más arriba); aprueba las de empleado/supervisor en **Aprobaciones**.
- En Fase 0 todos los ítems existen en el shell y rutean a un placeholder, **salvo Gestión de Usuarios, que es funcional**.

## Lenguaje visual

Ver skill `design-system`. En síntesis: sidebar azul oscuro colapsable + ítem activo en pastilla azul, topbar blanca (título + ícono + subtítulo a la izquierda; fecha, campana con badge y avatar a la derecha), contenido sobre gris claro, tarjetas blancas redondeadas con sombra suave, botones primario azul / secundario outline, badges de estado (Pendiente ámbar, Aprobado verde, Rechazado rojo). Logo `logo.fb.png` arriba del sidebar y en login. Fondo blanco.

## Idioma

Toda la UI, etiquetas, mensajes, mails y errores en **español (es-AR)**. Fechas/números/moneda con locale `es-AR`. Textos centralizados en `/lib/copy`. Sin strings hardcodeados en componentes.

## Seguridad (foco de auditoría)

1. RLS / límite de rol verificado en la base (empleado solo lo propio; supervisor solo su equipo vía `supervisor_id`; nunca funciones de admin desde otro rol).
2. Integridad del purgatorio (nada a `aprobado` sin admin).
3. Carga de archivos: validación, control de acceso en Storage, signed URLs.
4. Aprobaciones requieren auth de admin (no tokens abiertos).
5. **Sin secretos en el código**: solo variables de entorno.

## Definición de Done (compuerta)

Ver skill `dod-checklist`. No se considera done una historia sin: criterios del PRD cumplidos · tests verdes (incluido test de límite de rol para los 3 roles) · typecheck/lint/build en CI · RLS testeada por tabla · auditoría de Codex limpia · copy es-AR · sin secretos.

## Skills disponibles (en `.claude/skills/`)

Reutilizá y extendé estas skills; **no las recrees**.

- `supabase-migration` — migraciones versionadas, enums, RLS por rol, Storage, tipos TS.
- `design-system` — tokens de marca, chrome (sidebar/topbar), componentes base, login.
- `new-module` — scaffold de un módulo nuevo sensible a rol con su RLS, copy y tests.
- `purgatorio-form` — flujo Pendiente → Aprobar/Rechazar (pasajes, ausencias, documentos).
- `dod-checklist` — la compuerta de Definición de Done.

## Convención de tipos TypeScript

- **`supabase/types.ts` es el archivo generado** por `supabase gen types typescript --linked`. **No editar a mano**: se sobrescribe en cada regeneración.
- **`lib/db-types.ts` es el módulo estable de aliases** de conveniencia (enums, Row, Insert, Update). Importar aliases de ahí, no de `supabase/types.ts` directamente.
- La app importa `Database`, `Tables`, `Enums`, etc. de `@/supabase/types` solo para el tipado genérico del cliente Supabase. Para tipos nombrados (ej. `EmployeeStatus`, `ApprovalStatus`, `UserRole`…) usar `@/lib/db-types`.
- Tras cada migración: regenerar con `supabase gen types typescript --linked > supabase/types.ts`, agregar aliases nuevos en `lib/db-types.ts` si son necesarios, y commitear ambos archivos.

## Forma de trabajo

- Claude Code construye features + tests y abre PRs. **Codex no escribe código de features**: solo audita diffs contra el PRD + la constitución.
- Sin secretos: usá variables de entorno. No commitees claves.
- Generá y commiteá los tipos TS de Supabase tras cada migración.
- Cada historia cierra con la `dod-checklist`.

## Pendientes (los provee Luciano)

1. Método de auth final (propuesto y asumido: **invitación + contraseña**).
2. Email del primer admin (bootstrap por seed, vía env).
3. Dirección de Gmail para notificaciones (no bloquea Fase 0).
4. Proyecto Supabase (URL + keys), repo GitHub, `logo.fb.png` en `/public`.
