# FB-F3-AUD-08 - Auditoría PR #7: Dashboard de motivos de ausencia

> Fecha: 2026-07-06  
> Branch auditado: `feat/fb-f3-08-dashboard-motivos` contra `main` (`0e7edfe`)  
> Prompt: `docs/prompts/FB-F3-08.md`  
> Constitución: v0.5  
> Veredicto: **limpio para merge** (sin bloqueantes)

## Resumen

El dashboard cumple el alcance central de FB-F3-08: deriva el resumen desde `rotation_assignments`, usa el mismo scope de empleados/asignaciones que la grilla, filtra explícitamente por `user_id` y mes visible, presenta las 6 columnas fijas de motivo y no introduce cambios de esquema/RLS. No se detectaron fallas de scope ni de cálculo.

Se deja una **Nota** no bloqueante sobre el test unitario de navegación: prueba que se recalcula con distintos `days`, pero los asserts esperan el mismo conteo para julio y agosto, por lo que no evidencia literalmente que "los conteos cambian".

## 1. Scope de datos por rol - §4, §6

**Estado: cumple. Sin hallazgos.**

- La página usa `createServerClient()` para las lecturas de calendario, no `createAdminClient()` (`app/(app)/calendario/page.tsx:2`, `app/(app)/calendario/page.tsx:71`).
- El scope de empleados se resuelve una sola vez y se reutiliza para grilla y dashboard: `MotivoDashboard` recibe `computeMotivoDashboard(employees, assignments, days)` (`app/(app)/calendario/page.tsx:39`) y `RosterGrid` recibe los mismos `employees`/`assignments` (`app/(app)/calendario/page.tsx:45`).
- Admin: perfiles activos con rol `empleado` o `supervisor` (`app/(app)/calendario/page.tsx:77`, `app/(app)/calendario/page.tsx:79`).
- Supervisor: propia fila + equipo por `supervisor_id = profile.id` (`app/(app)/calendario/page.tsx:81`, `app/(app)/calendario/page.tsx:83`).
- Empleado: solo `id = profile.id` (`app/(app)/calendario/page.tsx:84`, `app/(app)/calendario/page.tsx:86`).
- Las asignaciones se filtran explícitamente sobre la columna real `user_id` con los IDs visibles, superpuesto a RLS (`app/(app)/calendario/page.tsx:107`, `app/(app)/calendario/page.tsx:110`).
- El test de integración replica el scope bajo `asUser` y verifica admin, supervisor, segundo supervisor y empleado (`tests/integration/calendario-dashboard-scope.test.ts:102`, `tests/integration/calendario-dashboard-scope.test.ts:121`, `tests/integration/calendario-dashboard-scope.test.ts:139`, `tests/integration/calendario-dashboard-scope.test.ts:155`).

## 2. Corrección del cálculo - FB-F3-08

**Estado: cumple. Sin hallazgos.**

- El cálculo solo cuenta `estado_dia === 'periodo_fuera_trabajo'` (`app/(app)/calendario/utils.ts:117`, `app/(app)/calendario/utils.ts:118`).
- Requiere `motivo_ausencia` y agrupa por `user_id` contra el mapa de empleados visibles (`app/(app)/calendario/utils.ts:119`, `app/(app)/calendario/utils.ts:121`, `app/(app)/calendario/utils.ts:123`).
- El mes visible se acota dos veces: query por `fecha` entre primer/último día (`app/(app)/calendario/page.tsx:111`, `app/(app)/calendario/page.tsx:112`) y filtro defensivo por `days` (`app/(app)/calendario/utils.ts:111`, `app/(app)/calendario/utils.ts:120`).
- Los tests unitarios cubren conteo por empleado/motivo, exclusión de otros meses y exclusión de estados distintos de `periodo_fuera_trabajo` (`tests/unit/calendario-dashboard.test.ts:40`, `tests/unit/calendario-dashboard.test.ts:57`, `tests/unit/calendario-dashboard.test.ts:70`).

## 3. Presentación - FB-F3-08

**Estado: cumple. Sin hallazgos.**

- Las 6 columnas fijas están definidas como `MOTIVOS_DASHBOARD`: `vacaciones`, `licencia_medica`, `dia_tramite`, `matrimonio`, `fallecimiento`, `otros` (`app/(app)/calendario/utils.ts:76`).
- Cada fila inicializa todos los motivos en 0 mediante `emptyMotivoCounts()` (`app/(app)/calendario/utils.ts:96`, `app/(app)/calendario/utils.ts:97`).
- La tabla renderiza esas columnas de forma estable, con headers desde copy (`app/(app)/calendario/MotivoDashboard.tsx:22`, `app/(app)/calendario/MotivoDashboard.tsx:24`, `app/(app)/calendario/MotivoDashboard.tsx:25`).
- `otros` se agrega como una celda numérica y el tipo de input excluye `motivo_otros_texto`; el comentario explicita que no se expone (`app/(app)/calendario/utils.ts:94`, `app/(app)/calendario/utils.ts:104`).
- El panel se renderiza antes de la card que contiene `MonthNav`, `Legend` y `RosterGrid` (`app/(app)/calendario/page.tsx:39`, `app/(app)/calendario/page.tsx:41`, `app/(app)/calendario/page.tsx:43`, `app/(app)/calendario/page.tsx:45`).
- `MonthNav` navega por `year`/`month`; la página recalcula `days`, `firstDay`, `lastDay` y vuelve a cargar assignments del mes (`app/(app)/calendario/MonthNav.tsx:20`, `app/(app)/calendario/MonthNav.tsx:30`, `app/(app)/calendario/page.tsx:62`, `app/(app)/calendario/page.tsx:67`).

## 4. Alcance acotado - FB-F3-08

**Estado: cumple. Sin hallazgos.**

- No se agregan alertas, topes ni límites en el dashboard; el diff relevante solo agrega presentación y agregación (`app/(app)/calendario/MotivoDashboard.tsx:14`, `app/(app)/calendario/utils.ts:106`).
- No hay tracking anual/histórico: el cálculo recibe `days` del mes visible y filtra por ese set (`app/(app)/calendario/utils.ts:109`, `app/(app)/calendario/utils.ts:111`, `app/(app)/calendario/utils.ts:120`).
- Confirmado sin cambios de esquema/policies/types en este PR: `git diff --name-only main...HEAD -- supabase/` no devuelve archivos.
- El dato se deriva de `rotation_assignments`, sin tabla nueva (`app/(app)/calendario/page.tsx:108`, `app/(app)/calendario/utils.ts:94`).

## 5. Transversales - §10, §12, §13

**Estado: cumple. Sin hallazgos.**

- Copy es-AR centralizado en `/lib/copy`: nombres de motivos (`lib/copy/index.ts:442`) y textos del dashboard (`lib/copy/index.ts:450`).
- La ruta muestra errores visibles en vez de degradar fallas a `[]`: empleados (`app/(app)/calendario/page.tsx:93`, `app/(app)/calendario/page.tsx:97`) y asignaciones (`app/(app)/calendario/page.tsx:114`, `app/(app)/calendario/page.tsx:118`).
- Búsqueda de secretos en el scope del dashboard: sin claves hardcodeadas ni uso de service role en `app/(app)/calendario/page.tsx`, `MotivoDashboard.tsx` o `utils.ts`; las apariciones de `createAdminClient()` están fuera de esta lectura.
- CI de integración hard-fail real: el workflow ejecuta `npm run test:integration` con `TEST_DATABASE_URL` (`.github/workflows/ci.yml:86`, `.github/workflows/ci.yml:89`) y el global setup lanza error si esa URL está configurada pero Postgres no responde (`tests/integration/global-setup.ts:15`, `tests/integration/global-setup.ts:18`).

## 6. Tests

**Estado: cumple con una nota no bloqueante.**

- Unitarios de cálculo: conteo por empleado/motivo, exclusión de otros meses y exclusión de no-`periodo_fuera_trabajo` (`tests/unit/calendario-dashboard.test.ts:40`, `tests/unit/calendario-dashboard.test.ts:57`, `tests/unit/calendario-dashboard.test.ts:70`).
- 6 columnas fijas en 0 (`tests/unit/calendario-dashboard.test.ts:88`).
- `otros` agrupado sin exponer texto libre (`tests/unit/calendario-dashboard.test.ts:100`, `tests/unit/calendario-dashboard.test.ts:109`, `tests/unit/calendario-dashboard.test.ts:110`).
- Scope por rol DB-backed bajo `asUser` (`tests/integration/calendario-dashboard-scope.test.ts:102`, `tests/integration/calendario-dashboard-scope.test.ts:121`, `tests/integration/calendario-dashboard-scope.test.ts:139`, `tests/integration/calendario-dashboard-scope.test.ts:155`).
- Ejecución local: `npm run test -- tests/unit/calendario-dashboard.test.ts` pasó (6/6). `npm run typecheck` pasó. `npm run test:integration -- tests/integration/calendario-dashboard-scope.test.ts` se salteó localmente por no tener Postgres disponible, consistente con `tests/integration/global-setup.ts:25`; en CI no puede saltearse silenciosamente si `TEST_DATABASE_URL` está configurada.
- PR #7: checks reportados por GitHub en éxito para `Typecheck · Lint · Tests · Build` y `Tests de integración RLS (Supabase local)`.

### Hallazgo

**Nota - Test de navegación no evidencia conteo distinto**

- Ubicación: `tests/unit/calendario-dashboard.test.ts:115`
- Evidencia: el caso "cambiar de mes recalcula" usa una asignación en julio y una en agosto, y espera `1` para julio y `1` para agosto (`tests/unit/calendario-dashboard.test.ts:121`, `tests/unit/calendario-dashboard.test.ts:125`). Esto prueba que `computeMotivoDashboard` puede recibir dos sets de días, pero no demuestra literalmente que "los conteos cambian" al cambiar de mes, como pide el prompt (`docs/prompts/FB-F3-08.md:63`).
- Regla: Tests FB-F3-08 - navegación, "cambiar de mes recalcula (los conteos cambian)".
- Recomendación: ajustar el fixture para que los conteos esperados difieran entre meses, por ejemplo julio = 2 y agosto = 0/1, o agregar un test de render/navegación de página que confirme que `year`/`month` cambian el rango consultado y el dashboard resultante.
- Impacto: no bloqueante. La implementación sí recalcula por `days` y por query de `fecha`; el hallazgo es de fortaleza de test, no de comportamiento observado.

## Veredicto

**Limpio para merge.**

No hay bloqueantes. El scope por rol y el cálculo mensual por motivo coinciden con FB-F3-08 y con la Constitución v0.5. Única observación: fortalecer el test de navegación para que el conteo esperado cambie entre meses.
