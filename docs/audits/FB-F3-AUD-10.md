# FB-F3-AUD-10 - Re-auditoría PR #8: cierre del bloqueante de racha por fechas consecutivas

> Fecha: 2026-07-06  
> Branch auditado: `feat/fb-f3-09-alertas-franco` (`e8e8c61`) contra `main` (`9de1f12`)  
> Fix auditado: `fe0cd3c` / `docs/prompts/FB-F3-10.md`  
> Auditoría base: `docs/audits/FB-F3-AUD-09.md`  
> Veredicto: **limpio para merge**

## Resumen

El bloqueante de FB-F3-AUD-09 quedó cerrado. La racha ya no itera filas existentes: indexa por `(user_id, fecha)` y camina por fechas calendario desde `today` hacia atrás. Un hueco corta, los neutrales explícitos siguen salteando y los estimados quedan fuera del índice, por lo que operan como hueco. Las dos notas también fueron atendidas con tests reforzados.

No detecté regresiones nuevas en scope, seguridad, copy, esquema ni CI.

## Hallazgo 1 - Racha por fechas consecutivas

**Estado: Cerrado.**

- `computeStreak` ahora recibe un índice `Map` y recorre fechas con `for (let i = 0; i < windowDays; i++)`, calculando `fecha = addDays(today, -i)` para cada día calendario (`app/(app)/calendario/francoAlerts.ts:95`, `app/(app)/calendario/francoAlerts.ts:104`).
- El índice usa la clave `user_id|fecha`, equivalente al lookup por `(user_id, fecha)` (`app/(app)/calendario/francoAlerts.ts:84`, `app/(app)/calendario/francoAlerts.ts:132`).
- Un día sin fila corta la racha con `if (!dia) break` (`app/(app)/calendario/francoAlerts.ts:105`, `app/(app)/calendario/francoAlerts.ts:106`).
- Los únicos días que se saltean sin cortar son los estados mapeados como `neutral`; el mapeo sigue centralizado en `FRANCO_ALERTAS` (`app/(app)/calendario/francoAlerts.ts:37`, `app/(app)/calendario/francoAlerts.ts:55`, `app/(app)/calendario/francoAlerts.ts:110`).
- Si hoy no tiene fila, el primer lookup falla y la racha queda en 0; los tests cubren hueco en hoy para A y B (`tests/unit/calendario-franco-alertas.test.ts:165`, `tests/unit/calendario-franco-alertas.test.ts:175`).

Regla: FB-F3-10, "hueco corta" y recorrido por fechas consecutivas (`docs/prompts/FB-F3-10.md:35`, `docs/prompts/FB-F3-10.md:45`).

## Punto A - Fixtures reconstruidos y tests de hueco

**Estado: Cerrado.**

- Los fixtures de reset A/B fueron reconstruidos con fechas contiguas y siguen probando el reset real: `en_franco` corta Alerta A sin arrastrar 50 días viejos (`tests/unit/calendario-franco-alertas.test.ts:85`, `tests/unit/calendario-franco-alertas.test.ts:98`) y `trabajando` corta Alerta B sin arrastrar 15 días viejos (`tests/unit/calendario-franco-alertas.test.ts:145`, `tests/unit/calendario-franco-alertas.test.ts:152`).
- Los neutrales se prueban en secuencias contiguas, sin huecos accidentales: Alerta A (`tests/unit/calendario-franco-alertas.test.ts:100`, `tests/unit/calendario-franco-alertas.test.ts:117`) y Alerta B (`tests/unit/calendario-franco-alertas.test.ts:154`, `tests/unit/calendario-franco-alertas.test.ts:162`).
- Los 4 tests nuevos de hueco existen: hueco en hoy para A (`tests/unit/calendario-franco-alertas.test.ts:166`), hueco en hoy para B (`tests/unit/calendario-franco-alertas.test.ts:172`), hueco entre bloques para A (`tests/unit/calendario-franco-alertas.test.ts:178`) y hueco entre bloques para B (`tests/unit/calendario-franco-alertas.test.ts:192`).

## Punto B - `es_estimado = true` corta

**Estado: Cerrado.**

- La implementación excluye `es_estimado = true` del índice (`app/(app)/calendario/francoAlerts.ts:129`, `app/(app)/calendario/francoAlerts.ts:132`).
- El comentario explicita la intención: un día estimado o ausente es indistinguible de un hueco y ambos cortan (`app/(app)/calendario/francoAlerts.ts:88`, `app/(app)/calendario/francoAlerts.ts:94`).
- El test confirma que un estimado intercalado corta y evita sumar días viejos (`tests/unit/calendario-franco-alertas.test.ts:204`, `tests/unit/calendario-franco-alertas.test.ts:214`).

Interpretación: cumple con FB-F3-10. El comportamiento es coherente con "conteo sobre días reales": si el único registro de una fecha es estimado, no hay dato real para sostener la racha vigente.

## Hallazgo 2 - Test de zona horaria no vacuo

**Estado: Cerrado.**

- El test ahora usa 47 días reales hasta el hoy AR y 1 día futuro (`tests/unit/calendario-franco-alertas.test.ts:223`, `tests/unit/calendario-franco-alertas.test.ts:241`).
- Con `hoyNegocio = 2026-07-14` no hay alerta (`tests/unit/calendario-franco-alertas.test.ts:243`, `tests/unit/calendario-franco-alertas.test.ts:247`).
- Con el "hoy" UTC incorrecto `2026-07-15`, el fixture sí llega a 48 y generaría falso positivo (`tests/unit/calendario-franco-alertas.test.ts:249`, `tests/unit/calendario-franco-alertas.test.ts:257`).

## Hallazgo 3 - Empleado en integración `asUser`

**Estado: Cerrado.**

- Se agregó `EMPLOYEE_EMPLOYEES_QUERY` con `id = $1` (`tests/integration/calendario-franco-scope.test.ts:44`, `tests/integration/calendario-franco-scope.test.ts:48`).
- El nuevo caso corre bajo `asUser(IDS.employee1)` (`tests/integration/calendario-franco-scope.test.ts:161`, `tests/integration/calendario-franco-scope.test.ts:162`).
- Verifica que el scope queda en la propia fila y que no aparecen supervisor, compañero ni empleado ajeno (`tests/integration/calendario-franco-scope.test.ts:165`, `tests/integration/calendario-franco-scope.test.ts:174`).

Nota: el no-render del panel para empleado sigue cubierto a nivel Server Component (`tests/unit/calendario-server-boundary.test.ts:314`, `tests/unit/calendario-server-boundary.test.ts:320`), y esta integración suma defensa en profundidad sobre el scope DB-backed.

## Chequeo de regresión

**Estado: sin regresiones detectadas.**

- Bordes de umbral siguen cubiertos: 47/48/60 para A (`tests/unit/calendario-franco-alertas.test.ts:60`, `tests/unit/calendario-franco-alertas.test.ts:83`) y 9/10/12 para B (`tests/unit/calendario-franco-alertas.test.ts:121`, `tests/unit/calendario-franco-alertas.test.ts:143`).
- Scope por rol intacto: admin/supervisor/supervisor2 en integración (`tests/integration/calendario-franco-scope.test.ts:109`, `tests/integration/calendario-franco-scope.test.ts:150`) y empleado oculto en page unit (`tests/unit/calendario-server-boundary.test.ts:314`, `tests/unit/calendario-server-boundary.test.ts:320`).
- Lectura con `createServerClient()` y filtro explícito sobre `user_id` (`app/(app)/calendario/page.tsx:2`, `app/(app)/calendario/page.tsx:85`, `app/(app)/calendario/page.tsx:148`, `app/(app)/calendario/page.tsx:153`).
- Sin cambios de esquema/policies/types: `git diff --name-only main...HEAD -- supabase/` no devuelve archivos.
- Copy es-AR centralizado en `/lib/copy` y consumido por el panel (`lib/copy/index.ts:455`, `app/(app)/calendario/FrancoAlertPanel.tsx:21`).
- Reads con error visible, sin degradar fallas a `[]` (`app/(app)/calendario/page.tsx:107`, `app/(app)/calendario/page.tsx:112`, `app/(app)/calendario/page.tsx:155`, `app/(app)/calendario/page.tsx:160`).
- No se detectan secretos ni uso de `createAdminClient()` en la lectura del panel; las búsquedas de `notification_log`/`notification_type` solo aparecen en esquema preexistente, no en el fix.

## Verificación

- `npm run test -- tests/unit/calendario-franco-alertas.test.ts tests/unit/calendario-franco-panel.test.tsx tests/unit/calendario-server-boundary.test.ts`: pasó (40/40).
- `npm run typecheck`: pasó.
- `npm run test:integration -- tests/integration/calendario-franco-scope.test.ts`: se salteó localmente por falta de Postgres local.
- PR #8 reporta verdes `Typecheck · Lint · Tests · Build` y `Tests de integración RLS (Supabase local)` en GitHub.

## Veredicto

**Limpio para merge.**

El bloqueante de FB-F3-AUD-09 está cerrado y no quedan bloqueantes abiertos.
