# FB-F3-AUD-17 — Informe de auditoría (Codex)

Auditoría de esquema de la migración 0013 (`resolver_ausencia_request`), función `SECURITY DEFINER`. Obligatoria antes del push.

## Hallazgos
Ningún hallazgo bloqueante en el DDL de `0013_resolver_ausencia_request.sql`.

### Nota — Verificación de owner/catálogo post-push
- **Ubicación:** `supabase/migrations/0013_resolver_ausencia_request.sql:20`
- **Evidencia:** `0013` está solo Local; `supabase migration list` confirma remoto hasta `0012`. Por eso el catálogo remoto todavía no tiene la función. El DDL no hace `ALTER FUNCTION OWNER`, así que el owner será el rol que ejecute el push.
- **Regla:** en funciones `SECURITY DEFINER`, el owner define privilegios efectivos.
- **Recomendación:** después del `db push`, verificar `pg_proc.proowner`, `prosecdef`, `proconfig` y `proacl` en producción antes de cerrar el runbook.

### Nota — Drift detector no cubre toda la superficie SECURITY DEFINER
- **Ubicación:** `tests/integration/migration.test.ts:437`
- **Evidencia:** valida firma/default/retorno y grants, pero no `prosecdef`, `proconfig` ni owner.
- **Regla:** el foco de auditoría pedía validar por catálogo `SECURITY DEFINER` + `search_path`.
- **Recomendación:** agregar assertions de catálogo para esos campos. Es solo cobertura; el DDL auditado sí declara `SECURITY DEFINER` y `SET search_path = public`.

## Verificaciones limpias
- `SECURITY DEFINER` + `SET search_path = public` presentes en 0013.
- Guarda correcta: `auth.uid() IS NULL OR NOT public.is_admin()`.
- Admin real sale de `auth.uid()`/`is_admin()`, no de parámetros.
- `is_admin()`/`auth_role()` se reutilizan desde `0001`, ambas con `SECURITY DEFINER STABLE SET search_path = public`.
- Grants correctos: `REVOKE` a `PUBLIC`, `REVOKE` explícito a `anon`, `GRANT EXECUTE` solo a `authenticated`.
- `SELECT ... FOR UPDATE` serializa resolución concurrente de la misma solicitud.
- No hay `COMMIT`, `EXCEPTION` que trague errores ni subtransacción que rompa atomicidad.
- Apro, captura calendario previo y hace upsert por rango con `ON CONFLICT (user_id, fecha)`.
- Rechazo exige motivo no vacío y no toca `rotation_assignments`.
- 0013 solo agrega función + grants; no altera tablas, enums ni policies.
- PR #14 abierto y checks verdes: integración Supabase local, typecheck/lint/tests/build, Vercel.

## Veredicto
Limpio para merge. El `db push` sigue gateado por Luciano; en ese runbook conviene hacer la verificación de catálogo post-push indicada arriba.

## Resolución
La Nota de cobertura del drift detector se cerró con **FB-F3-18** (fix de solo-tests): assertions de catálogo para `prosecdef`, `proconfig` y owner-consistency agregadas. La Nota de verificación de owner post-push queda incorporada como paso obligatorio del runbook **FB-F3-RUN-04**.
