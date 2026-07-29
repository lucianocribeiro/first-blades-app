# FB-F4-AUD-09 — Re-auditoría acotada: guardas de rango invertido + target de pasaje malformado

> Re-auditoría acotada de PR #29 `feature/fb-f4-12-cambio-post-aprobacion -> main`, limitada a los dos hallazgos (Alto + Medio) de `FB-F4-AUD-08` corregidos por `FB-F4-13`.
> Fecha: 2026-07-29.

## Hallazgos

Ninguno en el alcance de FB-F4-AUD-09.

## Verificación

- El diff post-AUD-08 es acotado a `supabase/migrations/0017_cambio_post_aprobacion.sql:119`, `tests/integration/cancelar-editar-post-aprobacion.test.ts:641` y el prompt versionado. No cambian enum, columnas, grants ni drift detector.
- Las guardas quedaron antes del LIFO y antes de cualquier efecto:
  - **Ausencia:** `reviewed_at IS NULL` aborta en `supabase/migrations/0017_cambio_post_aprobacion.sql:123`; fechas nuevas obligatorias e invertidas abortan en `supabase/migrations/0017_cambio_post_aprobacion.sql:128-140`. El LIFO recién empieza en `supabase/migrations/0017_cambio_post_aprobacion.sql:143` y el borrado en `supabase/migrations/0017_cambio_post_aprobacion.sql:188`.
  - **Pasaje:** `dias_viaje IS NULL OR cardinality(...)=0` aborta en `supabase/migrations/0017_cambio_post_aprobacion.sql:344`; `reviewed_at IS NULL` aborta en `supabase/migrations/0017_cambio_post_aprobacion.sql:351`. El LIFO empieza en `supabase/migrations/0017_cambio_post_aprobacion.sql:360` y el borrado en `supabase/migrations/0017_cambio_post_aprobacion.sql:401`.
- Tests nuevos confirmados:
  - Pasaje `dias_viaje` NULL, `reviewed_at` NULL, `dias_viaje` vacío y ausencia `reviewed_at` NULL: `tests/integration/cancelar-editar-post-aprobacion.test.ts:643-734`.
  - Rango invertido sin efectos y día único permitido: `tests/integration/cancelar-editar-post-aprobacion.test.ts:762-803`.
  - El bypass temporal de CHECKs usa conexión aparte y restaura en `finally`: `tests/integration/cancelar-editar-post-aprobacion.test.ts:675-700` y `tests/integration/cancelar-editar-post-aprobacion.test.ts:708-733`.
- La suite existente de LIFO, guardas §6.1, cancelar/editar happy paths y conteos de audit sigue intacta en el mismo archivo. CI de PR #29 está verde: integración Supabase local, e2e Playwright, typecheck/lint/tests/build y Vercel pasaron en el run 30474872368.
- Localmente `npm run typecheck` pasó. La integración local quedó skipped por falta de PostgreSQL/Supabase en esta sesión; CI sí la corrió de verdad.

## Veredicto

Aprobado para el alcance de FB-F4-AUD-09. Los hallazgos Alto y Medio de FB-F4-AUD-08 quedaron resueltos sin regresión visible en su vecindad. PR #29 queda listo para gate de Luciano y luego FB-F4-RUN-04.
