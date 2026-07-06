# FB-F3-AUD-09 - Auditoría PR #8: Panel de alertas de franco in-app

> Fecha: 2026-07-06  
> Branch auditado: `feat/fb-f3-09-alertas-franco` contra `main` (`9de1f12`)  
> Prompt: `docs/prompts/FB-F3-09.md`  
> Constitución: v0.5  
> Veredicto: **requiere fix previo al merge**

## Resumen

El PR implementa el panel in-app sin cambios de esquema, usa `createServerClient()`, mantiene scope explícito sobre `user_id`, oculta el panel para empleado y concentra el mapeo estado->efecto en `FRANCO_ALERTAS`. La mayor parte del alcance está cubierta.

Hay un hallazgo bloqueante en la lógica central: la racha se calcula caminando sobre filas existentes de `rotation_assignments`, no sobre cada fecha consecutiva desde "hoy". Si falta una fila de calendario, el hueco se trata de hecho como neutral y puede mantener una alerta vigente aunque la secuencia consecutiva hasta hoy no esté demostrada. Dado que esta lógica será reutilizada por el cron de mail, debe corregirse antes del merge.

## 1. Lógica de racha - Reglas A y B

**Estado: no cumple completamente. Hallazgo bloqueante.**

- El mapeo estado->efecto está en un único lugar parametrizable: `FRANCO_ALERTAS` (`app/(app)/calendario/francoAlerts.ts:37`). Alerta A configura `trabajando` como suma, `en_franco` como reset y `en_viaje`/`periodo_fuera_trabajo` como neutrales (`app/(app)/calendario/francoAlerts.ts:39`, `app/(app)/calendario/francoAlerts.ts:45`). Alerta B configura `en_franco` como suma, `trabajando` como reset y los otros dos estados como neutrales (`app/(app)/calendario/francoAlerts.ts:50`, `app/(app)/calendario/francoAlerts.ts:56`).
- Los umbrales están parametrizados en 48/60 y 10/12 (`app/(app)/calendario/francoAlerts.ts:46`, `app/(app)/calendario/francoAlerts.ts:58`).
- `computeStreak` suma, corta en `resetea` y saltea neutrales (`app/(app)/calendario/francoAlerts.ts:82`, `app/(app)/calendario/francoAlerts.ts:88`).
- Los tests cubren bordes 47/48/60, 9/10/12, resets y neutrales (`tests/unit/calendario-franco-alertas.test.ts:43`, `tests/unit/calendario-franco-alertas.test.ts:69`, `tests/unit/calendario-franco-alertas.test.ts:86`, `tests/unit/calendario-franco-alertas.test.ts:104`, `tests/unit/calendario-franco-alertas.test.ts:129`, `tests/unit/calendario-franco-alertas.test.ts:137`).

### Hallazgo 1

**Alto - La racha ignora huecos de calendario y no camina por fechas consecutivas desde hoy**

- Ubicación: `app/(app)/calendario/francoAlerts.ts:79`
- Evidencia: el comentario dice que `computeStreak` camina desde "el día más reciente" de `diasDesc`, no desde `today` (`app/(app)/calendario/francoAlerts.ts:79`). El algoritmo itera solo las filas existentes (`app/(app)/calendario/francoAlerts.ts:84`) y nunca valida que la primera fila sea `today` ni que cada fila anterior sea la fecha calendario anterior, salvo neutrales explícitos. `computeFrancoAlerts` solo filtra fechas futuras (`app/(app)/calendario/francoAlerts.ts:108`) y luego ordena las filas recibidas (`app/(app)/calendario/francoAlerts.ts:117`).
- Impacto: si faltan filas de calendario dentro de la ventana, el hueco queda implícitamente salteado igual que un neutral. Ejemplo: 48 filas `trabajando` terminadas ayer, sin fila para hoy, disparan una alerta "ahora" aunque la racha no fue calculada caminando desde hoy. Lo mismo aplica a huecos entre dos bloques de días. Esto contradice el prompt, que exige "mirando hacia atrás la secuencia consecutiva de días por empleado" (`docs/prompts/FB-F3-09.md:36`) y especifica como neutrales solo `en_viaje` y `periodo_fuera_trabajo` (`docs/prompts/FB-F3-09.md:22`, `docs/prompts/FB-F3-09.md:30`).
- Regla: FB-F3-09, lógica de racha A/B y "caminando hacia atrás desde hoy".
- Recomendación: calcular la racha sobre fechas calendario consecutivas desde `today` hasta `windowStart`, indexando `rotation_assignments` por `user_id+fecha`. Solo los estados configurados como `neutral` deben saltearse. Definir explícitamente qué ocurre con una fecha sin fila; por seguridad, no debería comportarse como neutral silencioso. Agregar tests de hueco en `today` y hueco entre bloques para ambas alertas.

## 2. Días reales y zona horaria

**Estado: cumple en implementación; tests con nota.**

- Los días estimados se excluyen antes de agrupar por empleado (`app/(app)/calendario/francoAlerts.ts:106`, `app/(app)/calendario/francoAlerts.ts:107`).
- Se excluyen fechas posteriores al hoy de negocio (`app/(app)/calendario/francoAlerts.ts:108`).
- El default de `today` reutiliza `getBusinessToday()` (`app/(app)/calendario/francoAlerts.ts:98`, `app/(app)/calendario/francoAlerts.ts:101`), y la página lo importa desde el cron de promoción (`app/(app)/calendario/page.tsx:17`, `app/(app)/calendario/page.tsx:145`). `getBusinessToday()` usa `America/Argentina/Buenos_Aires` (`lib/rotation/promote-estimated.ts:5`, `lib/rotation/promote-estimated.ts:11`).

### Hallazgo 2

**Nota - El test de zona horaria es parcialmente vacuo**

- Ubicación: `tests/unit/calendario-franco-alertas.test.ts:168`
- Evidencia: el test incluye dos días y espera `rows` vacío (`tests/unit/calendario-franco-alertas.test.ts:176`, `tests/unit/calendario-franco-alertas.test.ts:185`). Aun si el día futuro contara, el resultado seguiría vacío porque `2 < 48`, como el propio comentario reconoce (`tests/unit/calendario-franco-alertas.test.ts:181`, `tests/unit/calendario-franco-alertas.test.ts:184`).
- Regla: FB-F3-09 tests, borde de zona horaria (`docs/prompts/FB-F3-09.md:87`).
- Recomendación: armar un fixture con 47 días reales hasta el hoy AR y 1 día futuro UTC; el test debe fallar si se cuenta el día futuro porque pasaría de 47 a 48.

## 3. Scope por rol - §4, §6

**Estado: cumple en implementación; cobertura de empleado no es integración `asUser`.**

- La lectura usa `createServerClient()` (`app/(app)/calendario/page.tsx:2`, `app/(app)/calendario/page.tsx:85`).
- El scope de perfiles coincide con grilla/dashboard: admin `role in empleado/supervisor`, supervisor `id` propio + `supervisor_id`, empleado solo `id` propio (`app/(app)/calendario/page.tsx:91`, `app/(app)/calendario/page.tsx:100`).
- El panel de alertas solo consulta para roles distintos de `empleado` (`app/(app)/calendario/page.tsx:143`, `app/(app)/calendario/page.tsx:144`), y se renderiza solo cuando `francoAlertRows !== null` (`app/(app)/calendario/page.tsx:49`, `app/(app)/calendario/page.tsx:51`).
- La query de alertas filtra explícitamente por `user_id` con `employeeIds`, superpuesto a RLS (`app/(app)/calendario/page.tsx:148`, `app/(app)/calendario/page.tsx:153`).
- La ventana está acotada con `FRANCO_ALERT_WINDOW_DAYS = 65` (`app/(app)/calendario/francoAlerts.ts:12`) y la página usa `gte(windowStart)`/`lte(today)` (`app/(app)/calendario/page.tsx:146`, `app/(app)/calendario/page.tsx:153`).
- Integración DB-backed cubre admin y supervisores bajo `asUser` (`tests/integration/calendario-franco-scope.test.ts:103`, `tests/integration/calendario-franco-scope.test.ts:120`, `tests/integration/calendario-franco-scope.test.ts:133`). Empleado no ve panel está cubierto a nivel Server Component mockeado (`tests/unit/calendario-server-boundary.test.ts:314`, `tests/unit/calendario-server-boundary.test.ts:320`).

### Hallazgo 3

**Nota - La cobertura de "empleado no ve panel" no es integración bajo `asUser`**

- Ubicación: `tests/integration/calendario-franco-scope.test.ts:103`
- Evidencia: el archivo de integración prueba admin, supervisor y supervisor2, pero no incluye caso `asUser(IDS.employee...)` (`tests/integration/calendario-franco-scope.test.ts:103`, `tests/integration/calendario-franco-scope.test.ts:145`). La visibilidad de empleado se prueba en unit con mocks (`tests/unit/calendario-server-boundary.test.ts:314`).
- Regla: FB-F3-09 tests de scope por rol, integración bajo `asUser` (`docs/prompts/FB-F3-09.md:89`).
- Recomendación: agregar un caso de integración o server-level test con sesión real/más cercana al runtime para verificar que el branch empleado no ejecuta la query de alertas ni renderiza panel. No bloquea por sí solo porque la implementación actual sí oculta el panel.

## 4. Alcance acotado

**Estado: cumple. Sin hallazgos.**

- El nuevo código de calendario no implementa mail, cron ni escritura en `notification_log`; el panel es de lectura (`app/(app)/calendario/FrancoAlertPanel.tsx:20`, `app/(app)/calendario/page.tsx:148`).
- No hay cambios en `supabase/` ni `supabase/types.ts`: `git diff --name-only main...HEAD -- supabase/` y `git diff --name-only main...HEAD -- supabase/types.ts` no devuelven archivos.
- La data se deriva de `rotation_assignments` (`app/(app)/calendario/page.tsx:149`), sin tabla nueva.

## 5. Andamiaje de test `findElement`

**Estado: cumple. Sin hallazgos.**

- El helper corta explícitamente al encontrar `RosterGrid` para no invocar un componente con hooks (`tests/unit/calendario-server-boundary.test.ts:159`, `tests/unit/calendario-server-boundary.test.ts:172`).
- El corte no debilita las aserciones existentes: cuando el target es `RosterGrid`, se devuelve antes del corte (`tests/unit/calendario-server-boundary.test.ts:170`), y cuando el target es `FrancoAlertPanel`, `RosterGrid` no puede contenerlo porque es una hoja posterior del árbol (`tests/unit/calendario-server-boundary.test.ts:171`).
- Los tests siguen verificando `readOnly` de grilla por rol y filtros de profiles (`tests/unit/calendario-server-boundary.test.ts:211`, `tests/unit/calendario-server-boundary.test.ts:244`, `tests/unit/calendario-server-boundary.test.ts:254`, `tests/unit/calendario-server-boundary.test.ts:265`), además de visibilidad del panel (`tests/unit/calendario-server-boundary.test.ts:309`).

## 6. Transversales - §10, §12, §13

**Estado: cumple. Sin hallazgos.**

- Copy es-AR del panel centralizado en `/lib/copy` (`lib/copy/index.ts:455`, `lib/copy/index.ts:470`), y el panel lo consume desde `copy.calendario.alertasFranco` (`app/(app)/calendario/FrancoAlertPanel.tsx:21`).
- No se detectan secretos ni service role en el scope de esta pieza; el uso de `createAdminClient()` encontrado está en cron/piezas admin preexistentes o de FB-F3-07, no en la lectura del panel.
- Las lecturas no degradan errores a `[]`: errores de perfiles, grilla y alertas devuelven UI visible con `copy.errors.generic` (`app/(app)/calendario/page.tsx:107`, `app/(app)/calendario/page.tsx:111`, `app/(app)/calendario/page.tsx:128`, `app/(app)/calendario/page.tsx:132`, `app/(app)/calendario/page.tsx:155`, `app/(app)/calendario/page.tsx:159`).

## 7. Tests

**Estado: parcialmente cumple.**

- Unitarios de racha A/B, umbrales, resets, neutrales y estimados: presentes (`tests/unit/calendario-franco-alertas.test.ts:43`, `tests/unit/calendario-franco-alertas.test.ts:104`, `tests/unit/calendario-franco-alertas.test.ts:147`).
- Presentación: estado vacío, fila con tipo/valor/umbral, fallback email, ambas alertas y nivel visual 1 vs 2 (`tests/unit/calendario-franco-panel.test.tsx:15`, `tests/unit/calendario-franco-panel.test.tsx:82`).
- Scope: admin/supervisores en integración DB-backed; empleado en unit server boundary (`tests/integration/calendario-franco-scope.test.ts:103`, `tests/unit/calendario-server-boundary.test.ts:314`).
- CI hard-fail real de integración: el workflow levanta Supabase local y corre `npm run test:integration` con `TEST_DATABASE_URL` (`.github/workflows/ci.yml:74`, `.github/workflows/ci.yml:89`); el global setup lanza error si esa URL está configurada y Postgres no responde (`tests/integration/global-setup.ts:15`, `tests/integration/global-setup.ts:19`).
- Ejecución local: `npm run test -- tests/unit/calendario-franco-alertas.test.ts tests/unit/calendario-franco-panel.test.tsx tests/unit/calendario-server-boundary.test.ts` pasó (36/36). `npm run typecheck` pasó. `npm run test:integration -- tests/integration/calendario-franco-scope.test.ts` se salteó localmente por no tener Postgres disponible; PR #8 reporta verde `Tests de integración RLS (Supabase local)`.

## Veredicto

**Requiere fix previo al merge.**

Bloqueante:

- **Alto:** la racha ignora huecos de calendario y no camina por fechas consecutivas desde hoy (`app/(app)/calendario/francoAlerts.ts:79`).

No bloqueantes:

- **Nota:** fortalecer test de zona horaria para que el día futuro cambie el resultado si se cuenta indebidamente.
- **Nota:** agregar cobertura de empleado no ve panel bajo integración/session real, además del unit actual.
