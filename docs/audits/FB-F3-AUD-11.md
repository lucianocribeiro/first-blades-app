# FB-F3-AUD-11 - Auditoría PR #9: secciones colapsables + filtro por empleado

> Fecha: 2026-07-06  
> Branch auditado: `feat/fb-f3-11-colapsables-filtro` (`e2e5013`) contra `main` (`0bd09da`)  
> Prompt: `docs/prompts/FB-F3-11.md`  
> Veredicto: **limpio para merge**

## Resumen

No detecté hallazgos bloqueantes. El filtro por empleado no introduce una fuente nueva de datos ni dispara queries: opera en cliente sobre `employees`, `assignments`, `motivoRows` y `francoAlertRows` ya resueltos por `page.tsx` bajo el scope de rol. Un valor manipulado fuera del scope solo filtraría contra arrays que no contienen ese empleado, por lo que no puede expandir datos.

Las secciones colapsables cumplen el default B, persisten su preferencia en cookie de UI y el filtro no persiste entre montajes. No hay cambios de esquema/policies en `supabase/`.

## 1. Filtro por empleado no amplía scope

**Estado: cumple. Sin hallazgos.**

- La query base sigue usando `createServerClient()` (`app/(app)/calendario/page.tsx:89`) y aplica scope explícito de app antes de leer datos dependientes: admin por roles empleado/supervisor (`app/(app)/calendario/page.tsx:97`), supervisor por equipo + propia fila (`app/(app)/calendario/page.tsx:99`, `app/(app)/calendario/page.tsx:101`) y empleado solo su id (`app/(app)/calendario/page.tsx:102`, `app/(app)/calendario/page.tsx:104`).
- Las lecturas de `rotation_assignments` quedan acotadas a `employeeIds` ya scopeados, sobre `user_id`, tanto para el mes visible (`app/(app)/calendario/page.tsx:125`, `app/(app)/calendario/page.tsx:130`) como para alertas de franco (`app/(app)/calendario/page.tsx:152`, `app/(app)/calendario/page.tsx:157`).
- El filtro es solo presentación: `selectedIds` vive en `useState` (`app/(app)/calendario/CalendarioSections.tsx:50`, `app/(app)/calendario/CalendarioSections.tsx:52`) y filtra arrays ya recibidos por props (`app/(app)/calendario/CalendarioSections.tsx:62`, `app/(app)/calendario/CalendarioSections.tsx:75`). No hay query nueva ni fuente alternativa.
- El selector ofrece exactamente `employees` recibido por props (`app/(app)/calendario/CalendarioSections.tsx:83`, `app/(app)/calendario/CalendarioSections.tsx:84`; `app/(app)/calendario/EmployeeFilter.tsx:14`, `app/(app)/calendario/EmployeeFilter.tsx:20`, `app/(app)/calendario/EmployeeFilter.tsx:75`).
- Caso manipulado: aunque `selectedIds` contuviera un id fuera de scope, los filtros usan `employees.filter`, `assignments.filter`, `motivoRows.filter` y `francoAlertRows.filter` sobre arrays ya acotados (`app/(app)/calendario/CalendarioSections.tsx:63`, `app/(app)/calendario/CalendarioSections.tsx:75`). No hay camino para obtener datos de ese id.
- Para empleado, el server pasa `showFilter={profile.role !== 'empleado'}` (`app/(app)/calendario/page.tsx:193`, `app/(app)/calendario/page.tsx:194`) y el cliente omite el control (`app/(app)/calendario/CalendarioSections.tsx:83`, `app/(app)/calendario/CalendarioSections.tsx:85`).

Reglas: Constitución §4, §6, §12; prompt FB-F3-11, filtro dentro del scope de rol.

## 2. Colapsables y default

**Estado: cumple. Sin hallazgos.**

- Las tres secciones se renderizan con `CollapsibleSection`: alertas (`app/(app)/calendario/CalendarioSections.tsx:87`, `app/(app)/calendario/CalendarioSections.tsx:96`), resumen de motivos (`app/(app)/calendario/CalendarioSections.tsx:99`, `app/(app)/calendario/CalendarioSections.tsx:106`) y calendario (`app/(app)/calendario/CalendarioSections.tsx:108`, `app/(app)/calendario/CalendarioSections.tsx:123`).
- El encabezado es un `button` nativo con `aria-expanded` (`components/ui/CollapsibleSection.tsx:29`, `components/ui/CollapsibleSection.tsx:32`) y el contenido no se renderiza cuando está colapsado (`components/ui/CollapsibleSection.tsx:46`, `components/ui/CollapsibleSection.tsx:51`).
- El default sin cookie es opción B: alertas y resumen colapsados, calendario expandido (`app/(app)/calendario/collapseState.ts:15`, `app/(app)/calendario/collapseState.ts:19`).
- El título colapsado de alertas incluye el contador de empleados únicos en alerta (`app/(app)/calendario/CalendarioSections.tsx:77`, `app/(app)/calendario/CalendarioSections.tsx:89`).
- La navegación del mes permanece dentro de la sección calendario y recibe `year/month` de la página (`app/(app)/calendario/CalendarioSections.tsx:108`, `app/(app)/calendario/CalendarioSections.tsx:119`), por lo que el render server recalcula las props del mes visible.

Regla: prompt FB-F3-11, colapsables opción B.

## 3. Persistencia por cookie

**Estado: cumple. Sin hallazgos.**

- La preferencia usa la cookie `fb_calendario_secciones` (`app/(app)/calendario/collapseState.ts:10`) y se documenta como dato cosmético, sin base ni `localStorage` (`app/(app)/calendario/collapseState.ts:1`, `app/(app)/calendario/collapseState.ts:4`).
- El server component lee con `cookies()` en el render inicial y parsea antes de pasar `initialCollapseState` (`app/(app)/calendario/page.tsx:177`, `app/(app)/calendario/page.tsx:181`).
- La última preferencia gana: `toggleSection` actualiza estado y escribe cookie (`app/(app)/calendario/CalendarioSections.tsx:54`, `app/(app)/calendario/CalendarioSections.tsx:59`), y `setCollapseCookie` serializa solo el estado booleano de UI (`app/(app)/calendario/collapseState.ts:45`, `app/(app)/calendario/collapseState.ts:46`).
- Cookie ausente o malformada cae al default sin lanzar (`app/(app)/calendario/collapseState.ts:31`, `app/(app)/calendario/collapseState.ts:40`).
- No hay uso de `localStorage` en la implementación; la búsqueda de `localStorage` en los archivos del PR no devuelve uso operativo.

Regla: prompt FB-F3-11, persistencia por cookie sin parpadeo y sin datos sensibles.

## 4. Filtro no persiste

**Estado: cumple. Sin hallazgos.**

- El filtro vive únicamente en `useState` local de `CalendarioSections` (`app/(app)/calendario/CalendarioSections.tsx:50`, `app/(app)/calendario/CalendarioSections.tsx:52`).
- No se serializa en cookie, URL, storage ni base. La única persistencia agregada es `setCollapseCookie`, usada solo por `toggleSection` (`app/(app)/calendario/CalendarioSections.tsx:54`, `app/(app)/calendario/CalendarioSections.tsx:57`).
- El test de remount confirma que una nueva instancia arranca sin filtro aunque la anterior hubiera filtrado (`tests/unit/calendario-sections.test.tsx:152`, `tests/unit/calendario-sections.test.tsx:167`).

Regla: prompt FB-F3-11, contraste intencional con colapsado persistente.

## 5. Sin cambios de datos/scope/esquema

**Estado: cumple. Sin hallazgos.**

- `git diff --name-only main...HEAD -- supabase/` no devuelve archivos: sin cambios de esquema, migrations, policies ni tipos Supabase.
- El cálculo base de motivos sigue en server sobre `employees`, `assignments` y `days` del mes visible (`app/(app)/calendario/page.tsx:175`) y el dashboard quedó headless, sin query propia ni cambio de columnas (`app/(app)/calendario/MotivoDashboard.tsx:9`, `app/(app)/calendario/MotivoDashboard.tsx:27`).
- El panel de alertas también quedó headless: mantiene la tabla y delega el encabezado al wrapper colapsable (`app/(app)/calendario/FrancoAlertPanel.tsx:9`, `app/(app)/calendario/FrancoAlertPanel.tsx:15`).
- No se agregaron alertas, topes, tracking histórico ni tablas nuevas; el cambio es de presentación y filtrado sobre datos ya resueltos.

Regla: prompt FB-F3-11, pieza de UI sin alterar seguridad, datos ni cálculo.

## 6. Andamiaje de test

**Estado: cumple. Sin hallazgos.**

- `findElement` ahora corta al encontrar `CalendarioSections`, porque ese componente usa hooks y no debe invocarse a mano en el test server-boundary (`tests/unit/calendario-server-boundary.test.ts:161`, `tests/unit/calendario-server-boundary.test.ts:188`).
- Las aserciones relevantes no se debilitaron: siguen verificando readOnly por rol (`tests/unit/calendario-server-boundary.test.ts:224`, `tests/unit/calendario-server-boundary.test.ts:255`), scope de profiles para supervisor/empleado/admin (`tests/unit/calendario-server-boundary.test.ts:257`, `tests/unit/calendario-server-boundary.test.ts:286`), `showFilter` por rol (`tests/unit/calendario-server-boundary.test.ts:301`, `tests/unit/calendario-server-boundary.test.ts:329`) y cookie inicial (`tests/unit/calendario-server-boundary.test.ts:339`, `tests/unit/calendario-server-boundary.test.ts:382`).

Regla: prompt FB-F3-11, el ajuste de test no debe enmascarar scope ni visibilidad por rol.

## 7. Transversales y tests

**Estado: cumple. Sin hallazgos.**

- Copy es-AR centralizado en `/lib/copy`: motivos (`lib/copy/index.ts:442`, `lib/copy/index.ts:449`), dashboard (`lib/copy/index.ts:450`, `lib/copy/index.ts:453`), alertas (`lib/copy/index.ts:455`, `lib/copy/index.ts:470`) y filtro (`lib/copy/index.ts:471`, `lib/copy/index.ts:477`).
- Las fallas de lectura no degradan silenciosamente a `[]`: empleados, asignaciones y alertas devuelven error visible (`app/(app)/calendario/page.tsx:111`, `app/(app)/calendario/page.tsx:117`; `app/(app)/calendario/page.tsx:132`, `app/(app)/calendario/page.tsx:138`; `app/(app)/calendario/page.tsx:159`, `app/(app)/calendario/page.tsx:165`).
- No se detectaron secretos nuevos ni uso de `createAdminClient()` en las lecturas del calendario; la lectura del calendario usa `createServerClient()` (`app/(app)/calendario/page.tsx:89`).
- Tests cubren colapsado, `aria-expanded`, contenido no renderizado, default, preferencia por cookie, cookie malformada, filtro sobre las tres secciones, filtro no persistente y visibilidad por rol (`tests/unit/collapsible-section.test.tsx:32`, `tests/unit/collapsible-section.test.tsx:104`; `tests/unit/calendario-collapse-state.test.ts:17`, `tests/unit/calendario-collapse-state.test.ts:56`; `tests/unit/calendario-sections.test.tsx:83`, `tests/unit/calendario-sections.test.tsx:193`; `tests/unit/calendario-server-boundary.test.ts:296`, `tests/unit/calendario-server-boundary.test.ts:383`).
- CI tiene integración RLS con Supabase local y hard-fail cuando `TEST_DATABASE_URL` está configurado (`.github/workflows/ci.yml:74`, `.github/workflows/ci.yml:89`; `tests/integration/global-setup.ts:15`, `tests/integration/global-setup.ts:24`).

## Verificación ejecutada

- `npm run test -- tests/unit/calendario-collapse-state.test.ts tests/unit/collapsible-section.test.tsx tests/unit/calendario-employee-filter.test.tsx tests/unit/calendario-sections.test.tsx tests/unit/calendario-server-boundary.test.ts`: pasó, 51/51 tests.
- `npm run typecheck`: pasó.
- `gh pr view 9 --json ...`: PR #9 reporta verdes `Typecheck · Lint · Tests · Build`, `Tests de integración RLS (Supabase local)` y Vercel; `mergeStateStatus: CLEAN`.

## Veredicto

**Limpio para merge.**

No quedan bloqueantes abiertos para PR #9.
