# FB-F3-AUD-04 — Auditoría: Grilla del roster con edición de estados del admin

> **Audita:** PR #4 / build `FB-F3-04`  
> **Fecha:** 2026-07-03  
> **Base auditada:** `feat/fb-f3-04-grilla-roster-edicion-admin` (`79a252c`) contra `main` (`47f3f91`)  
> **Referencias:** Constitución v0.5, PRD Fase 3, `docs/prompts/FB-F3-04.md`

## Hallazgos

### Medio — Cobertura incompleta para la grilla, la ruta y el upsert real

**Ubicación:** `tests/unit/calendario-utils.test.ts:12`, `tests/unit/calendario-utils.test.ts:25`, `tests/unit/calendario-server-boundary.test.ts:47`, `tests/unit/calendario-server-boundary.test.ts:68`

**Evidencia:** los tests nuevos cubren utilidades puras importadas desde `app/(app)/calendario/utils` (`tests/unit/calendario-utils.test.ts:12-20`) y validación de motivos (`tests/unit/calendario-validation.test.ts:14-76`), pero no renderizan `RosterGrid`/`CellEditModal` con Testing Library ni verifican filas, columnas y botones en DOM. Además, el test de gating de ruta afirma que admin, supervisor y empleado pueden acceder a `/calendario` (`tests/unit/calendario-utils.test.ts:25-30`), pero no prueba que un no-admin reciba el placeholder y no la vista de edición. El test de upsert mockea Supabase (`tests/unit/calendario-server-boundary.test.ts:47-52`) y solo verifica que se llama `.upsert(..., { onConflict: 'user_id,fecha' })` (`tests/unit/calendario-server-boundary.test.ts:68-88`); no hay prueba DB-backed de crear, actualizar y no duplicar.

**Regla:** `docs/prompts/FB-F3-04.md:60-64` exige tests de render de grilla, upsert que actualiza/crea sin duplicar y gating/RLS; Constitución §13 exige tests pasando con límite de rol.

**Recomendación:** agregar tests de componente para `RosterGrid`/`CellEditModal` (filas x días, celda vacía gris, estimado claro, validación visible), un test de ruta/server boundary que pruebe el branch no-admin de `CalendarioPage`, y un test de integración o DB-backed para el upsert admin sobre `rotation_assignments` que demuestre insert/update sin duplicado por `UNIQUE (user_id, fecha)`.

## 1. Gating de rol y RLS

**Estado:** cumple en implementación; cobertura de ruta incompleta por el hallazgo anterior.

- La vista de gestión está gated en servidor: `CalendarioPage` llama `requireAuth()` y, si `profile.role !== 'admin'`, retorna `PlaceholderPage` antes de crear cliente o cargar datos (`app/(app)/calendario/page.tsx:17-27`).
- La escritura tiene backstop de servidor: `upsertRotationAssignment()` llama `requireAdmin()` antes de validar o escribir (`app/(app)/calendario/actions.ts:19-23`); `requireAdmin()` delega en `requireRole('admin')`, que redirige no-admin a `/dashboard` (`lib/auth.ts:29-36`).
- Lectura y escritura usan `createServerClient()` (`app/(app)/calendario/page.tsx:38`, `app/(app)/calendario/actions.ts:39`). No hay `createAdminClient()` en `app/(app)/calendario/*`.
- RLS existente cubre `rotation_assignments`: empleado/supervisor solo SELECT de scope propio/equipo y sin escritura; admin completo (`tests/integration/rls.test.ts:619-759`). La ejecución local de integración quedó skipped por falta de PostgreSQL local, pero CI configura `TEST_DATABASE_URL` (`.github/workflows/ci.yml:86-89`) y el global setup falla si esa URL está configurada y la DB no responde (`tests/integration/global-setup.ts:15-24`).
- No hubo cambios de esquema ni policies en este PR: `git diff --name-only main...HEAD -- supabase/migrations supabase/types.ts` no devuelve archivos.

## 2. Integridad de la escritura

**Estado:** cumple en implementación; falta prueba de efecto real DB-backed.

- La server action arma payload con `user_id`, `fecha`, `estado_dia`, `es_estimado`, `motivo_ausencia` y `motivo_otros_texto` (`app/(app)/calendario/actions.ts:25-35`).
- El upsert usa `onConflict: 'user_id,fecha'` sobre `rotation_assignments` (`app/(app)/calendario/actions.ts:44-46`).
- La UI valida `periodo_fuera_trabajo` antes de llamar la action (`app/(app)/calendario/CellEditModal.tsx:64-73`) y la action repite la validación antes del upsert (`app/(app)/calendario/actions.ts:22-23`).
- `otros` exige texto y máximo 80 caracteres en la validación compartida (`app/(app)/calendario/utils.ts:85-104`).
- Las opciones de UI están restringidas a los 4 estados y motivos enum (`app/(app)/calendario/CellEditModal.tsx:21-35`), y el esquema/RLS de integración verifica `UNIQUE (user_id, fecha)` y el CHECK de motivo (`tests/integration/migration.test.ts:193-221`).

## 3. Roster y visualización

**Estado:** cumple.

- La grilla usa días como columnas y empleados como filas (`app/(app)/calendario/RosterGrid.tsx:40-86`).
- La vista mensual se genera con `getDaysInMonth()` y navega con `MonthNav` (`app/(app)/calendario/page.tsx:29-36`, `app/(app)/calendario/page.tsx:89`).
- Los empleados salen de `profiles`, filtrados por rol empleado/supervisor y status activo (`app/(app)/calendario/page.tsx:40-45`).
- Hay 4 estados, celda vacía gris y tono claro para estimado (`app/(app)/calendario/utils.ts:44-59`).
- La leyenda incluye estados, sin cargar y estimado (`app/(app)/calendario/Legend.tsx:4-28`).
- Los tokens de color están centralizados en Tailwind (`tailwind.config.ts:20-26`).

## 4. Alcance acotado

**Estado:** sin hallazgos.

- El PR agrega solo piezas del calendario, copy/tokens/tipos y tests unitarios asociados; no toca migraciones ni `supabase/types.ts`.
- No se implementan cron de promoción, vistas de lectura supervisor/empleado, alertas de franco, días de trámite, import/export Excel ni pintado por rango. La única referencia al cron es comentario explícito de pieza posterior (`app/(app)/calendario/utils.ts:62-64`).
- La grilla es componente propio (`app/(app)/calendario/RosterGrid.tsx:27-99`) y reutiliza componentes base (`app/(app)/calendario/CellEditModal.tsx:5-8`).

## 5. Transversales

**Estado:** cumple.

- Copy es-AR centralizado en `lib/copy` para títulos, navegación, modal, leyenda, motivos y errores (`lib/copy/index.ts:402-459`).
- No se observan secretos en los archivos tocados.
- Los reads no degradan silenciosamente errores: empleados y asignaciones retornan error visible si Supabase falla (`app/(app)/calendario/page.tsx:47-54`, `app/(app)/calendario/page.tsx:68-75`).
- La escritura no traga excepciones: loguea el error de Supabase y lanza copy genérico visible en el modal (`app/(app)/calendario/actions.ts:48-50`, `app/(app)/calendario/CellEditModal.tsx:86-88`, `app/(app)/calendario/CellEditModal.tsx:157-160`).

## 6. Tests

**Estado:** requiere fix por cobertura incompleta.

- Existen tests unitarios de visual de celda vacía/estimado/tokens (`tests/unit/calendario-utils.test.ts:114-138`), validación de motivo y otros (`tests/unit/calendario-validation.test.ts:27-75`), server action con no-admin bloqueado (`tests/unit/calendario-server-boundary.test.ts:55-66`) y llamada de upsert con `onConflict` (`tests/unit/calendario-server-boundary.test.ts:68-88`).
- RLS de base para `rotation_assignments` está cubierta bajo `asUser` en integración (`tests/integration/rls.test.ts:619-759`).
- Falta render real de grilla/ruta y falta upsert DB-backed que pruebe insert/update sin duplicación; ver hallazgo.

## Verificación ejecutada

- `npm test -- --run tests/unit/calendario-utils.test.ts tests/unit/calendario-validation.test.ts tests/unit/calendario-server-boundary.test.ts` → pasa, 32 tests.
- `npm run typecheck` → pasa.
- `npm test` → pasa, 250 tests.
- `npm run lint` → pasa, sin warnings/errores.
- `npm run build` → pasa.
- `npm run test:integration` → skipped localmente por PostgreSQL no disponible; CI está configurado para hard-fail con `TEST_DATABASE_URL`.

## Veredicto

**Requiere fix previo al merge.**

Bloqueante: cerrar el hallazgo de cobertura incompleta para cumplir la Definition of Done del prompt y de la Constitución §13. La implementación auditada no muestra brechas de seguridad o integridad, pero el PR no demuestra con tests suficientes el render de la grilla/ruta ni el comportamiento real de upsert create/update sin duplicar.
