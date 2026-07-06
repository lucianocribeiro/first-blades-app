# FB-F3-AUD-07 — Auditoría: Cron de promoción estimado → real

> **Audita:** PR #6 / build `FB-F3-07`  
> **Fecha:** 2026-07-03  
> **Base auditada:** `feat/fb-f3-07-cron-promocion-estimados` (`472ff05`) contra `main` (`fdc7490`)  
> **Referencias:** Constitución v0.5, PRD Fase 3, `docs/prompts/FB-F3-07.md`

## Hallazgos

Sin hallazgos.

## 1. Seguridad del endpoint

**Estado:** cumple.

- El endpoint `GET /api/cron/promote-estimated-days` lee `Authorization` y `CRON_SECRET`, y falla cerrado con `401` si falta el secret o el bearer no coincide (`app/api/cron/promote-estimated-days/route.ts:7-13`).
- En el branch `401` retorna antes de ejecutar `promoteEstimatedDays()` (`app/api/cron/promote-estimated-days/route.ts:11-16`).
- Reutiliza `CRON_SECRET`; `.env.example` ya lo documenta sin valor (`.env.example:37-40`).
- Sigue el molde de los crons existentes: mismo patrón de `Authorization: Bearer <CRON_SECRET>` y respuesta `401` (`app/api/cron/document-expiry-alerts/route.ts:7-13`, `app/api/cron/purge-rejected-docs/route.ts:7-13`).
- Tests de auth cubren sin header, bearer incorrecto, secret no seteado y caso exitoso (`tests/unit/promote-estimated-cron-auth.test.ts:26-62`).

## 2. Scope del UPDATE bajo service-role

**Estado:** cumple.

- La lógica usa `createAdminClient()` por defecto, es decir service-role server-side (`lib/rotation/promote-estimated.ts:3`, `lib/rotation/promote-estimated.ts:39-41`; cliente service-role en `lib/supabase/admin.ts:4-15`).
- El `UPDATE` está explícitamente acotado a `rotation_assignments`, solo cambia `{ es_estimado: false }`, filtra `es_estimado = true` y `fecha <= cutoff`, y solo selecciona `id` para contar afectadas (`lib/rotation/promote-estimated.ts:45-50`).
- Opera sobre la fecha per-día real `fecha`, no toca otras tablas ni otras columnas (`lib/rotation/promote-estimated.ts:46-50`).
- Si Supabase devuelve error, la función lanza excepción (`lib/rotation/promote-estimated.ts:52`); el endpoint la expone como `500` (`app/api/cron/promote-estimated-days/route.ts:19-23`).
- En éxito loguea la cantidad promovida (`app/api/cron/promote-estimated-days/route.ts:15-18`).

## 3. Ventana de 7 días y zona horaria

**Estado:** cumple.

- El PRD exige promoción a real 7 días antes (`docs/prd-fase-3.md:17-20`) y la decisión de build fija `fecha <= hoy + 7 días` (`docs/prd-fase-3.md:71-72`).
- "Hoy" se calcula con `Intl.DateTimeFormat` en `America/Argentina/Buenos_Aires`, no UTC crudo (`lib/rotation/promote-estimated.ts:5-13`).
- El cutoff suma exactamente `PROMOTION_WINDOW_DAYS = 7` y devuelve fecha `YYYY-MM-DD` (`lib/rotation/promote-estimated.ts:6`, `lib/rotation/promote-estimated.ts:19-23`).
- La condición de promoción es inclusiva por `.lte('fecha', cutoff)` (`lib/rotation/promote-estimated.ts:48-50`).
- Tests unitarios cubren borde de zona horaria AR vs UTC, límite de 03:00 UTC, suma exacta de 7 días y cruces de mes/año (`tests/unit/promote-estimated.test.ts:12-51`).

## 4. Idempotencia

**Estado:** cumple.

- La función solo actualiza filas con `es_estimado = true`; las ya promovidas quedan fuera de corridas posteriores (`lib/rotation/promote-estimated.ts:45-50`).
- La única mutación es `es_estimado: false`; no hay código que vuelva a setear `true` (`lib/rotation/promote-estimated.ts:45-50`).
- Integración DB-backed valida que la primera corrida promueve dentro de ventana y deja fuera de ventana/ya reales intactas (`tests/integration/promote-estimated.test.ts:73-85`).
- Integración DB-backed valida segunda corrida idempotente con `promoted = 0` y mismo estado final (`tests/integration/promote-estimated.test.ts:87-98`).

## 5. Alcance acotado

**Estado:** sin hallazgos.

- El diff del PR agrega solo endpoint, helper, prompt, tests y `vercel.json`; no toca UI ni otras piezas (`git diff --stat main...HEAD`).
- No hay cambios en `supabase/`: `git diff --name-only main...HEAD -- supabase/` no devuelve archivos.
- No hay cambios en `.env.example` ni valores secretos nuevos; `CRON_SECRET` preexistente queda vacío (`.env.example:37-40`).
- El cron quedó agendado diariamente en `vercel.json` a `/api/cron/promote-estimated-days` (`vercel.json:11-14`).
- No se implementan alertas de franco, días de trámite, import/export Excel ni pintado por rango en este PR.

## 6. Tests

**Estado:** cumple.

- DB-backed de promoción/no promoción/no reversión/idempotencia (`tests/integration/promote-estimated.test.ts:73-98`).
- Auth del cron con falla cerrada y no ejecución sin bearer válido (`tests/unit/promote-estimated-cron-auth.test.ts:36-53`).
- Borde de zona horaria y ventana exacta de 7 días (`tests/unit/promote-estimated.test.ts:12-51`).
- CI hard-fail de integración: el workflow configura `TEST_DATABASE_URL` (`.github/workflows/ci.yml:86-89`) y el global setup falla si esa URL existe pero la DB no responde (`tests/integration/global-setup.ts:15-24`).
- CI verde verificado con `gh pr view 6`: `Typecheck · Lint · Tests · Build` y `Tests de integración RLS (Supabase local)` concluyeron `SUCCESS` el 2026-07-03.

## Verificación ejecutada

- `npm test -- --run tests/unit/promote-estimated.test.ts tests/unit/promote-estimated-cron-auth.test.ts` → pasa, 13 tests.
- `npm run typecheck` → pasa.
- `npm run lint` → pasa, sin warnings/errores.
- `npm run build` → pasa.
- `npm test` → pasa, 284 tests.
- `npm run test:integration` → skipped localmente por PostgreSQL no disponible; CI sí ejecutó integración con Supabase local y pasó.
- `gh pr view 6 --json ...` → PR `CLEAN`, checks requeridos en `SUCCESS`.

## Veredicto

**Limpio para merge.**

No hay bloqueantes. El PR cumple seguridad de endpoint con falla cerrada, scope explícito del `UPDATE` bajo service-role, ventana de 7 días con fecha de negocio en Argentina, idempotencia, agendado diario y ausencia de cambios de esquema/policies.
