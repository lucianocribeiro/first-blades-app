# FB-F4-AUD-08 — Auditoría: migración 0017 cambio post-aprobación (RPCs cancelar/editar + guarda LIFO)

> Auditoría independiente de PR #29 `feature/fb-f4-12-cambio-post-aprobacion -> main` contra Constitución v0.6 (§6.1) y prompt `FB-F4-12`.
> Fecha: 2026-07-29.

## Hallazgos

### Alto — `editar_fechas` de ausencia acepta rangos invertidos

**Ubicación:** `supabase/migrations/0017_cambio_post_aprobacion.sql:119`, línea de escritura `supabase/migrations/0017_cambio_post_aprobacion.sql:225`, `tests/integration/cancelar-editar-post-aprobacion.test.ts:619`.

**Evidencia:** la RPC solo valida que `p_nueva_fecha_inicio` y `p_nueva_fecha_fin` no sean `NULL`. No valida `p_nueva_fecha_inicio <= p_nueva_fecha_fin`. Luego borra el rango viejo, el `WHILE v_dia <= p_nueva_fecha_fin` no escribe ningún día si el rango viene invertido, y finalmente actualiza `ausencia_requests.fecha_inicio`/`fecha_fin` con valores inválidos.

**Regla violada:** FB-F4-12 exige "rango para ausencia" y `editar_fechas` debe borrar viejos + escribir nuevos + actualizar fechas de forma coherente. También rompe la expectativa de invariantes server-side en una RPC `SECURITY DEFINER`.

**Recomendación:** antes de LIFO/efectos, agregar `IF p_accion = 'editar_fechas' AND p_nueva_fecha_fin < p_nueva_fecha_inicio THEN RAISE ...`. Cubrirlo con integración real.

### Medio — pasajes aprobados legacy/malformed con `dias_viaje NULL` pueden saltear la semántica de días

**Ubicación:** `supabase/migrations/0017_cambio_post_aprobacion.sql:319`, LIFO pasaje `supabase/migrations/0017_cambio_post_aprobacion.sql:338`, borrado pasaje `supabase/migrations/0017_cambio_post_aprobacion.sql:369`, `0016` nullable `supabase/migrations/0016_resolver_pasaje.sql:23`.

**Evidencia:** `0016` deja `pasaje_requests.dias_viaje` nullable para no romper filas existentes. La nueva RPC solo exige `p_nuevos_dias` no vacío al editar, pero no exige que el objetivo aprobado tenga `v_request.dias_viaje` cargado. Con `dias_viaje NULL`, el LIFO por pasaje no computa intersecciones reales y el borrado `fecha = ANY(v_request.dias_viaje)` no libera días, pero la solicitud puede quedar marcada como cancelada/editada.

**Regla violada:** la guarda LIFO y la lógica de cancelar/editar definen el conjunto de días de pasaje como `dias_viaje`. Si ese conjunto no existe, la RPC no puede cumplir "borra exactamente los días del objetivo" ni "conjunto de días correcto por tipo".

**Recomendación:** rechazar objetivos de pasaje aprobados con `dias_viaje IS NULL OR cardinality(dias_viaje)=0`; idealmente rechazar también `reviewed_at IS NULL` porque LIFO depende de ese orden. Agregar tests de filas legacy/malformed.

## Confirmaciones relevantes

- La guarda LIFO usa `reviewed_at`, cruza ambas tablas, filtra mismo empleado, detecta solapamiento parcial con arrays y excluye `post_aprobacion_tipo='cancelada'`. El error identifica tipo + id + fechas + `reviewed_at`.
- Las dos RPCs tienen `SECURITY DEFINER`, `SET search_path=public`, guarda `auth.uid() IS NULL OR NOT public.is_admin()`, `SELECT ... FOR UPDATE`, comentario obligatorio, grants a `authenticated` y revoke de `anon`/`PUBLIC`.
- El drift detector inventaría enum, columnas, firmas, `prosecdef`, `proconfig`, owner-consistency y grants. CI de PR #29 está verde en GitHub: typecheck/lint/tests/build, integración Supabase local, e2e y Vercel.
- Localmente corrí `npm run typecheck` y pasó. `npm run test:integration -- cancelar-editar-post-aprobacion.test.ts migration.test.ts` no ejecutó tests reales porque PostgreSQL local no está disponible en esta sesión; quedaron 94 skipped.

## Veredicto

No apruebo el merge todavía. La migración está bien encaminada en LIFO y seguridad, pero el rango invertido en ausencia es un defecto funcional de datos en una RPC privilegiada. Corregir ese punto antes del merge; el caso `dias_viaje NULL` debería blindarse en la misma pasada por robustez frente a legacy/drift.
