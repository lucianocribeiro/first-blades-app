# FB-F3-AUD-13 — Auditoría de esquema: cron de alertas de franco

> **Fase:** 3 — Calendario de Rotaciones  
> **Tipo:** Auditoría de esquema previa al `db push`  
> **PR auditado:** #11 — `feat/fb-f3-13-cron-alertas-franco` (`0fb8b28`) contra `main`  
> **Fecha:** 2026-07-07  
> **Constitución:** v0.5 (`docs/constitucion.md`)  
> **Prompt:** `docs/prompts/FB-F3-13.md`

## Veredicto

**Apto para `db push`.**

No encontré hallazgos bloqueantes. Las migraciones `0010`/`0011` son aditivas/forward-only, mantienen intacta la idempotencia de alertas documentales y agregan una clave separada para alertas de franco. El cron cumple el alcance de FB-F3-13: `Bearer CRON_SECRET`, service-role acotado, destinatarios admin-only, idempotencia por episodio, marca-después-de-enviar y fallo parcial por destinatario.

## Estado Local/Remote

**Estado:** OK.

Evidencia por `supabase migration list`:

```text
Local | Remote
0001  | 0001
0002  | 0002
0003  | 0003
0004  | 0004
0005  | 0005
0006  | 0006
0007  | 0007
0008  | 0008
0009  | 0009
0010  |
0011  |
```

Esto confirma el estado esperado: `0001`-`0009` coinciden entre Local y Remote; `0010` y `0011` están solo Local, pendientes de `db push`.

## 1. No-regresión de alertas de documento

**Estado:** OK, sin hallazgos.

- `notification_log` en `0008` nace con `document_id UUID NOT NULL`, `UNIQUE (tipo, document_id, umbral, recipient_profile_id)`, `notification_log_umbral_valido` en `{5,15,30}` y RLS deny-all: `supabase/migrations/0008_notification_log.sql:12`, `supabase/migrations/0008_notification_log.sql:15`, `supabase/migrations/0008_notification_log.sql:20`, `supabase/migrations/0008_notification_log.sql:22`, `supabase/migrations/0008_notification_log.sql:33`.
- `0011` solo baja `document_id` a nullable para permitir filas no documentales: `supabase/migrations/0011_notification_log_franco_alertas.sql:35`.
- La forma por tipo evita ambigüedad: `vencimiento_documento` exige `document_id IS NOT NULL` y `empleado_id`/`racha_inicio` nulos; `sin_franco`/`franco_excedido` exigen `document_id IS NULL` y `empleado_id` + `racha_inicio`: `supabase/migrations/0011_notification_log_franco_alertas.sql:47`.
- La `UNIQUE` documental de `0008` no se reemplaza ni se elimina; el drift detector la exige exacta: `tests/integration/migration.test.ts:345`.
- El índice único de franco es separado: `(tipo, empleado_id, umbral, racha_inicio, recipient_profile_id) WHERE document_id IS NULL`: `supabase/migrations/0011_notification_log_franco_alertas.sql:75`. Por el CHECK anterior, ese parcial cubre solo tipos de franco.
- El CHECK de umbrales conserva documentos en `{5,15,30}` y agrega franco en `{48,60}` / `{10,12}`: `supabase/migrations/0011_notification_log_franco_alertas.sql:65`.
- Tests DB-backed cubren rechazo de forma inválida, aceptación de franco válido, umbral documental intacto y convivencia con el parcial: `tests/integration/franco-alerts-notification-log.test.ts:50`, `tests/integration/franco-alerts-notification-log.test.ts:87`, `tests/integration/franco-alerts-notification-log.test.ts:146`, `tests/integration/franco-alerts-notification-log.test.ts:199`.
- Tests existentes de documentos siguen cubriendo duplicado documental y RLS deny-all: `tests/integration/notification-log.test.ts:72`, `tests/integration/notification-log.test.ts:115`.

Conclusión: cada alerta cae bajo una única regla efectiva. Documentos siguen protegidos por la `UNIQUE` original y franco queda protegido por el índice parcial; el CHECK de forma impide huecos y solapes.

## 2. Migración 0010 — enum

**Estado:** OK, sin hallazgos.

- `0010` agrega exactamente `sin_franco` y `franco_excedido`, sin remover ni renombrar el valor existente: `supabase/migrations/0010_notification_type_franco.sql:9`.
- La separación `0010`/`0011` está justificada para evitar el uso inseguro de un enum recién agregado en la misma migración: `supabase/migrations/0010_notification_type_franco.sql:4`.
- El drift detector es estricto con `toEqual(['vencimiento_documento', 'sin_franco', 'franco_excedido'])`: `tests/integration/migration.test.ts:254`.

## 3. Migración 0011 — columnas, unicidad y RLS

**Estado:** OK, sin hallazgos.

- `document_id` pasa a nullable: `supabase/migrations/0011_notification_log_franco_alertas.sql:35`.
- `empleado_id` se agrega como FK a `profiles`, nullable: `supabase/migrations/0011_notification_log_franco_alertas.sql:39`.
- `racha_inicio DATE` se agrega nullable: `supabase/migrations/0011_notification_log_franco_alertas.sql:43`.
- La unicidad de franco queda en índice único parcial por `(tipo, empleado_id, umbral, racha_inicio, recipient_profile_id) WHERE document_id IS NULL`: `supabase/migrations/0011_notification_log_franco_alertas.sql:75`.
- RLS sigue deny-all: `0008` habilita RLS sin policies (`supabase/migrations/0008_notification_log.sql:30`) y `0011` no agrega policies. El drift detector exige cero policies: `tests/integration/migration.test.ts:357`.
- La numeración es forward-only y no reescribe `0001`-`0009`: archivos nuevos `supabase/migrations/0010_notification_type_franco.sql` y `supabase/migrations/0011_notification_log_franco_alertas.sql`.
- Drift detector cubre `document_id` nullable, columnas nuevas, FK, CHECKs, índice parcial y `UNIQUE` documental intacta: `tests/integration/migration.test.ts:265`, `tests/integration/migration.test.ts:274`, `tests/integration/migration.test.ts:299`, `tests/integration/migration.test.ts:317`, `tests/integration/migration.test.ts:332`, `tests/integration/migration.test.ts:345`.

## 4. Idempotencia por episodio

**Estado:** OK, sin hallazgos.

- `FrancoAlertRow` incluye `rachaInicio` como fecha del día más antiguo de la racha vigente: `app/(app)/calendario/francoAlerts.ts:69`.
- `computeStreak` deriva `inicio` caminando la racha vigente hacia atrás y corta ante huecos o estados de reset: `app/(app)/calendario/francoAlerts.ts:108`.
- `computeFrancoAlerts` rellena `rachaInicio` al cruzar 48/60 o 10/12: `app/(app)/calendario/francoAlerts.ts:157`, `app/(app)/calendario/francoAlerts.ts:168`.
- La clave lógica del cron es `tipo|empleado_id|umbral|racha_inicio|recipient_profile_id`: `lib/notifications/franco-alerts.ts:66`.
- Tests unitarios cubren: mismo día/misma racha no reenvía, misma racha con umbral 60 sí avisa, y misma alerta con otra `racha_inicio` sí avisa por episodio nuevo: `tests/unit/franco-alerts.test.ts:166`, `tests/unit/franco-alerts.test.ts:181`, `tests/unit/franco-alerts.test.ts:198`.
- Tests DB-backed cubren duplicado exacto rechazado, otro destinatario permitido y otra `racha_inicio` permitida: `tests/integration/franco-alerts-notification-log.test.ts:161`, `tests/integration/franco-alerts-notification-log.test.ts:175`, `tests/integration/franco-alerts-notification-log.test.ts:187`.

Conclusión: implementa la opción 1 del prompt (`docs/prompts/FB-F3-13.md:50`): no repite el mismo umbral en la misma racha, pero permite otro umbral u otro episodio.

## 5. Cron

**Estado:** OK, sin hallazgos.

- Endpoint `GET /api/cron/franco-alerts` con `Authorization: Bearer CRON_SECRET`; si falta secret o header correcto devuelve 401: `app/api/cron/franco-alerts/route.ts:7`, `app/api/cron/franco-alerts/route.ts:11`.
- Está agendado diario en Vercel: `vercel.json:15`.
- Usa `createAdminClient()` en runner de sistema, no en UI/feature client-side: `lib/notifications/franco-alerts-runner.ts:12`.
- El scope se acota en store: empleados activos `empleado/supervisor`, admins por rol, y `rotation_assignments` de empleados + ventana `[windowStart,today]`: `lib/notifications/franco-alerts-store.ts:77`, `lib/notifications/franco-alerts-store.ts:87`, `lib/notifications/franco-alerts-store.ts:96`.
- Reutiliza `computeFrancoAlerts` y `getFrancoAlertWindowStart`; no duplica la lógica de racha: `lib/notifications/franco-alerts.ts:10`, `lib/notifications/franco-alerts.ts:85`, `lib/notifications/franco-alerts.ts:89`.
- Destinatarios solo admins: `runFrancoAlerts` obtiene solo `store.getAdmins()` y itera admins, no empleado/supervisor: `lib/notifications/franco-alerts.ts:93`, `lib/notifications/franco-alerts.ts:150`; test explícito: `tests/unit/franco-alerts.test.ts:135`.
- Marca después de enviar y maneja `try/catch` por destinatario: `lib/notifications/franco-alerts.ts:119`, `lib/notifications/franco-alerts.ts:137`.
- Mail en es-AR con terminología amigable; el copy dice "Alerta de descanso", "días sin descanso" y "días de franco prolongado": `lib/copy/index.ts:329`, `lib/copy/index.ts:472`; test prohíbe "racha"/"umbral" en output: `tests/unit/franco-alerts.test.ts:295`.

## 6. Transversales y tests

**Estado:** OK, con nota operativa.

- Sin secretos nuevos: `.env.example` reutiliza `GMAIL_*`, `GOOGLE_SERVICE_ACCOUNT_KEY_B64` y `CRON_SECRET`: `.env.example:23`, `.env.example:37`.
- El transporte real de Gmail está inyectado solo en runner; los tests mockean `send`: `lib/notifications/franco-alerts-runner.ts:10`, `tests/unit/franco-alerts.test.ts:91`, `tests/integration/franco-alerts-notification-log.test.ts:237`.
- Auth 401 cubierto: `tests/unit/franco-alerts-cron-auth.test.ts:34`, `tests/unit/franco-alerts-cron-auth.test.ts:40`, `tests/unit/franco-alerts-cron-auth.test.ts:46`.
- Fallo parcial cubierto: `tests/unit/franco-alerts.test.ts:242`.
- CI del PR #11 está verde en GitHub: `Typecheck · Lint · Tests · Build` SUCCESS, `Tests de integración RLS (Supabase local)` SUCCESS, Vercel SUCCESS.
- Verificación local ejecutada:
  - `npm test -- --run tests/unit/franco-alerts.test.ts tests/unit/franco-alerts-cron-auth.test.ts ...`: 20 tests unitarios relevantes passed.
  - `npm run test:integration -- --run tests/integration/migration.test.ts tests/integration/notification-log.test.ts tests/integration/franco-alerts-notification-log.test.ts`: 53 tests skipped localmente porque no hay PostgreSQL local ni `TEST_DATABASE_URL`.
  - `npm run typecheck`: passed.

Nota: la limitación local de integración no bloquea esta auditoría porque el PR reporta los checks de integración con Supabase local en verde.

## Hallazgos

**Sin hallazgos bloqueantes.**

No se detectaron hallazgos Crítico/Alto/Medio/Bajo que requieran fix previo al push.

## Cierre

**Apto para `db push`** de `0010` y `0011`.

Bloqueantes: ninguno.
