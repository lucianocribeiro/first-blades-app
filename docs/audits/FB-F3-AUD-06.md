# FB-F3-AUD-06 — Auditoría: Vistas de lectura del roster

> **Audita:** PR #5 / build `FB-F3-06`  
> **Fecha:** 2026-07-03  
> **Base auditada:** `feat/fb-f3-06-vistas-lectura-roster` (`15bd8c7`) contra `main` (`e33759e`)  
> **Referencias:** Constitución v0.5, PRD Fase 3, `docs/prompts/FB-F3-06.md`

## Hallazgos

Sin hallazgos.

## 1. Scope de datos

**Estado:** cumple.

- `/calendario` resuelve el rol en servidor con `requireAuth()` (`app/(app)/calendario/page.tsx:49-57`).
- Las lecturas usan `createServerClient()` (`app/(app)/calendario/page.tsx:68`), sin `createAdminClient()` en `app/(app)/calendario/*`.
- Supervisor: la query de filas filtra explícitamente su propia fila + equipo con `id.eq.${profile.id},supervisor_id.eq.${profile.id}` (`app/(app)/calendario/page.tsx:78-80`). Luego las asignaciones se limitan a esos perfiles mediante `.in('user_id', employeeIds)` sobre la columna real `user_id` (`app/(app)/calendario/page.tsx:99-109`).
- Empleado: la query de filas filtra explícitamente por su `id` (`app/(app)/calendario/page.tsx:81-84`) y las asignaciones vuelven a quedar acotadas por `.in('user_id', employeeIds)` (`app/(app)/calendario/page.tsx:102-109`).
- La cobertura DB-backed replica el scope de app bajo `asUser`: supervisor ve sí mismo + su equipo y no ve equipo ajeno (`tests/integration/calendario-scope.test.ts:56-86`); empleado ve exactamente su propia fila (`tests/integration/calendario-scope.test.ts:88-95`).
- RLS de `rotation_assignments` ya cubre lecturas y negativos por id directo bajo `asUser`: empleado no ve fila ajena, supervisor no ve calendario de otro equipo, y no-admin no escribe (`tests/integration/rls.test.ts:619-759`).

## 2. Ausencia de escritura para no-admin

**Estado:** cumple.

- `RosterGrid` recibe `readOnly` y en modo lectura renderiza un `div` sin `onClick` en lugar de `button` (`app/(app)/calendario/RosterGrid.tsx:28-30`, `app/(app)/calendario/RosterGrid.tsx:73-88`).
- `CellEditModal` solo puede abrirse si `selected` cambia, y en modo lectura no hay handler que llame a `setSelected` (`app/(app)/calendario/RosterGrid.tsx:74-88`, `app/(app)/calendario/RosterGrid.tsx:99-105`).
- La server action existente sigue gateada con `requireAdmin()` antes de validar o escribir (`app/(app)/calendario/actions.ts:19-23`).
- Tests: modo lectura no renderiza botones (`tests/unit/calendario-grid.test.tsx:96-104`) y no-admin no llega al upsert (`tests/unit/calendario-server-boundary.test.ts:58-69`).

## 3. Gating de ruta por rol

**Estado:** cumple.

- La ruta elige en servidor: admin editable, supervisor lectura, empleado lectura (`app/(app)/calendario/page.tsx:49-57`, `app/(app)/calendario/page.tsx:123-131`).
- El `PlaceholderPage` ya no se importa ni se usa en la ruta; no-admin recibe `RosterGrid readOnly` (`app/(app)/calendario/page.tsx:1-10`, `app/(app)/calendario/page.tsx:123-131`).
- Tests de branch por rol: supervisor y empleado reciben `readOnly=true`; admin recibe `readOnly=false` (`tests/unit/calendario-server-boundary.test.ts:201-237`).
- La ruta sigue disponible para los tres roles en el mapa global (`lib/roles.ts:19-30`).

## 4. Reutilización de la grilla

**Estado:** cumple.

- Se reutiliza el mismo `RosterGrid` con prop `readOnly?: boolean` (`app/(app)/calendario/RosterGrid.tsx:15-20`, `app/(app)/calendario/RosterGrid.tsx:28`).
- No hay componente duplicado de grilla en el diff del PR; los archivos modificados son `page.tsx`, `RosterGrid.tsx`, prompt y tests.
- La vista admin conserva comportamiento editable (`readOnly={!isAdmin}` con admin => `false`) (`app/(app)/calendario/page.tsx:123-131`).
- Regresión visual cubierta: modo lectura mantiene gris, sólido y estimado claro (`tests/unit/calendario-grid.test.tsx:106-125`), y modo editable sigue renderizando botones (`tests/unit/calendario-grid.test.tsx:136-139`).

## 5. Alcance acotado

**Estado:** sin hallazgos.

- No se agregó edición para no-admin; `readOnly` desactiva interacción de celda (`app/(app)/calendario/RosterGrid.tsx:73-88`).
- No aparecen cron de promoción, alertas, días de trámite, import/export Excel ni pintado por rango en el diff de esta rama.
- Confirmación de esquema: `git diff --name-only main...HEAD -- supabase/` no devuelve archivos; no hay cambios de migraciones, policies ni `supabase/types.ts`.

## 6. Transversales

**Estado:** cumple.

- La UI nueva usa copy existente centralizado (`copy.calendario.*`) en la ruta y grilla (`app/(app)/calendario/page.tsx:34-35`, `app/(app)/calendario/RosterGrid.tsx:34`, `app/(app)/calendario/RosterGrid.tsx:45`).
- Sin secretos en los archivos tocados.
- Los reads no degradan errores a `[]`: errores de `profiles` y `rotation_assignments` se loguean y devuelven mensaje visible (`app/(app)/calendario/page.tsx:86-97`, `app/(app)/calendario/page.tsx:102-120`).

## 7. Tests

**Estado:** cumple.

- Gating por rol: `CalendarioPage` se prueba para admin/supervisor/empleado (`tests/unit/calendario-server-boundary.test.ts:201-237`).
- Scope supervisor/empleado DB-backed bajo `asUser` (`tests/integration/calendario-scope.test.ts:56-95`).
- RLS de `rotation_assignments` con casos positivos/negativos y ausencia de escritura no-admin (`tests/integration/rls.test.ts:619-759`).
- Modo lectura sin controles de edición y regresión admin (`tests/unit/calendario-grid.test.tsx:96-139`).
- CI verde verificado con `gh pr view 5`: `Typecheck · Lint · Tests · Build` y `Tests de integración RLS (Supabase local)` concluyeron `SUCCESS` el 2026-07-03.

## Verificación ejecutada

- `npm test -- --run tests/unit/calendario-grid.test.tsx tests/unit/calendario-server-boundary.test.ts tests/unit/calendario-utils.test.ts tests/unit/calendario-validation.test.ts tests/unit/calendario-modal.test.tsx` → pasa, 53 tests.
- `npm run typecheck` → pasa.
- `npm test` → pasa, 271 tests.
- `npm run lint` → pasa, sin warnings/errores.
- `npm run build` → pasa.
- `npm run test:integration` → skipped localmente por PostgreSQL no disponible; CI sí ejecutó integración con Supabase local y pasó.
- `gh pr view 5 --json ...` → PR `CLEAN`, checks requeridos en `SUCCESS`.

## Veredicto

**Limpio para merge.**

No hay bloqueantes. El PR cumple scope de datos para supervisor/empleado, mantiene la escritura limitada a admin, reutiliza la grilla en modo lectura y no modifica esquema ni policies.
