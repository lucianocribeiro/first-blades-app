# FB-F5-AUD-06 — Auditoría de Codex

- **ID:** FB-F5-AUD-06
- **PR auditada:** #43
- **Rama:** `fase-5/f5-08-gestion-usuarios`
- **Fecha:** 2026-08-07
- **Veredicto:** `NO APROBADO — 1 hallazgo bloqueante (Hallazgo 1), 2 no bloqueantes`

---

# FB-F5-AUD-06 — Informe de Auditoría PR #43

## Veredicto

No apruebo el merge todavía si se exige cumplimiento estricto del foco 3: hay un hallazgo bloqueante por filtración de estado en el login/gate. El resto de lo auditado no muestra caminos al admin client sin `requireAdmin()`, ni filtración de la contraseña a `audit_log`.

PR auditado: #43, `fase-5/f5-08-gestion-usuarios` contra `main`.
CI remoto: verde en Typecheck/Lint/Tests/Build, Integración RLS y E2E.
Verificación local: `npm run test -- tests/unit/password.test.ts tests/unit/gestion-usuarios-actions.test.ts tests/unit/auth-gate.test.ts` pasó 30/30; `npm run typecheck` pasó.

## Hallazgos

### 1. BLOQUEANTE — El mensaje del gate permite distinguir contraseña correcta de incorrecta/cuenta inexistente

- Severidad: Alta / Bloqueante
- Ubicación:
  - `app/login/LoginForm.tsx:36-38`
  - `app/login/page.tsx:14-18`
  - `tests/e2e/gestion-usuarios.spec.ts:97-104`
- Evidencia:
  - Si Supabase Auth rechaza login, la UI muestra `Correo o contraseña incorrectos.`.
  - Si el usuario inactivo ingresa email + contraseña correcta, `signInWithPassword` primero tiene éxito, luego `/dashboard` cae en `requireAuth()`, redirige a `/login?motivo=acceso`, y la página muestra `Tu sesión expiró. Iniciá sesión nuevamente.`.
  - El propio e2e fija esa diferencia como expectativa.
- Regla violada:
  - Foco 3: "Que el mensaje no filtre información: que no se pueda distinguir 'cuenta dada de baja' de 'cuenta que no existe' ni de 'contraseña incorrecta'."
- Recomendación:
  - Usar el mismo copy indistinguible para credenciales inválidas y para el redirect del gate posterior al login. No debe quedar una señal distinta cuando la contraseña era correcta pero la cuenta no está `activo`.

### 2. NO BLOQUEANTE — Los errores de `audit_log` devueltos por Supabase se tragan silenciosamente

- Severidad: Media
- Ubicación:
  - `app/(app)/gestion-usuarios/actions.ts:123-130`
  - `app/(app)/gestion-usuarios/actions.ts:159-166`
  - `app/(app)/gestion-usuarios/actions.ts:203-209`
  - Patrón original: `app/(app)/aprobaciones/actions.ts:37-48`
- Evidencia:
  - Las tres acciones hacen `await admin.from('audit_log').insert(...)` dentro de `try/catch`, pero no capturan ni loguean el `{ error }` que Supabase devuelve normalmente cuando falla una query.
  - El `catch` solo cubre excepciones lanzadas, no errores PostgREST resueltos como valor.
  - El test `tests/unit/gestion-usuarios-actions.test.ts:191-199` simula `auditInsertError`, pero solo verifica que la operación principal siga en `ok: true`; no verifica visibilidad del error.
- Regla violada:
  - Foco 2: "si falla la auditoría, la operación no se revierte, pero el error queda visible, no tragado."
- Recomendación:
  - Leer el resultado del insert: `const { error: auditError } = await ...`; si existe, `console.error(...)`. Mantener la operación principal no bloqueante.

### 3. NO BLOQUEANTE — Falta hardening del usuario objetivo en baja/reactivación/reset

- Severidad: Media
- Ubicación:
  - `app/(app)/gestion-usuarios/actions.ts:100-117`
  - `app/(app)/gestion-usuarios/actions.ts:139-155`
  - `app/(app)/gestion-usuarios/actions.ts:175-200`
  - `app/(app)/gestion-usuarios/UserTable.tsx:85-122`
- Evidencia:
  - Las actions aceptan un `id`/`userId` directo del cliente y no revalidan que el objetivo sea un perfil gestionable, ni bloquean que un admin se inactive a sí mismo.
  - La UI renderiza "Desactivar" para cualquier usuario activo, incluido potencialmente el admin actual.
  - `deactivateUser` y `activateUser` no verifican si la actualización afectó una fila; un id inexistente puede devolver `ok: true` y dejar un audit intentado sobre un `record_id` que no existía.
- Regla violada:
  - Foco 1/4: el id objetivo no debería permitir casos raros ni romper acceso propio de forma irrecuperable.
- Recomendación:
  - Releer el target server-side después de `requireAdmin()`, rechazar perfiles inexistentes, y bloquear self-deactivation/self-demotion si no hay una decisión explícita. Para `resetPassword`, al menos confirmar que el auth user corresponde a un `profiles` gestionado por la app.

## Confirmaciones

- `resetPassword` no alcanza `createAdminClient()` antes de `requireAdmin()`: guarda en `actions.ts:176`, validación en `178-179`, admin client en `181`, Auth admin en `200`.
- La verificación de admin sale de sesión real vía `createServerClient()` en `lib/auth.ts:8-20`, no de parámetros del cliente.
- No detecté contraseña en `audit_log`: `password_reset` no escribe `new_data` (`actions.ts:203-209`).
- Alta y reseteo usan un único helper compartido `validatePassword()` con reglas exactas: mínimo 8, número y mayúscula (`lib/password.ts:7-18`).
- Las tres operaciones sensibles registran audit en camino feliz: baja, reactivación y reset.
- El gate está centralizado en `requireAuth()` y cubre `app/(app)/layout.tsx:6`; por lo tanto cubre las rutas autenticadas bajo `app/(app)`.
- Rutas públicas/login quedan fuera de ese layout. Los crons están en `/api/cron/*`, no usan `requireAuth()`, y mantienen `CRON_SECRET`.
- No hay cambios en `supabase/` ni `supabase/types.ts` en el diff del PR.
- El diff del PR está acotado al alcance esperado. El working tree local tiene dos archivos no trackeados (`docs/pdr-fase-4.md`, `docs/pdr-fase-5.md`) que no forman parte del PR.

---

Los 3 hallazgos de este informe se resolvieron en FB-F5-09, con severidades retriagadas por el developer (ver `docs/prompts/FB-F5-09.md`): Hallazgo 1 (bloqueante para Codex) se bajó a menor — filtra únicamente el estado de una cuenta a quien ya tiene su contraseña correcta, no permite enumerar cuentas ni adivinar contraseñas — pero se corrigió de todas formas por su bajo costo, unificando el copy del gate (`motivo=acceso`) con el de credencial inválida. Hallazgo 3 (no bloqueante para Codex) se subió a bloqueante — un admin podía inactivarse a sí mismo y, si era el único admin, quedar sin acceso de forma irrecuperable — y se resolvió con un guard server-side contra el id de la sesión verificada, más re-lectura del perfil objetivo y verificación de filas afectadas en `deactivateUser`, `activateUser` y `resetPassword`. Hallazgo 2 se resolvió leyendo el resultado del insert a `audit_log` como valor en vez de un `try/catch` que nunca lo capturaba.
