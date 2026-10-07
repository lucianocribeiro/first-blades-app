# FB-PI-11-SCHEMA-PREPUSH — Auditoría de esquema previa al `db push` de la migración 0022

- **Fecha:** 2026-10-07
- **Rama:** `feat/fb-pi-11-import-calendario`
- **Prompts:** `docs/prompts/FB-PI-11.md`, `docs/prompts/FB-PI-11-B.md`
- **Inspección previa:** `docs/audits/FB-PI-11-INSPECT.md`
- **Migración:** `supabase/migrations/0022_import_calendario.sql`
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** queries de **solo lectura** a producción por MCP Supabase (ref `simfemdkrkdbumefcxei`): `pg_indexes`, `pg_proc`, `information_schema`, `pg_enum` y `count(*)` sobre `profiles` y `auth.users`. **Ninguna escritura en producción.** El `db push` no se corrió: lo corre Luciano por el runbook gateado (§2.3).

---

## 1. Acciones que tocaron producción

| Cuándo | Qué | Tipo |
|---|---|---|
| 2026-10-07 | Catálogo + conteos para el informe de inspección (`FB-PI-11-INSPECT.md`) | Solo lectura |
| 2026-10-07 | Queries de esta auditoría (§2) | Solo lectura |

Nada más. No se aplicó la migración, no se regeneraron tipos contra `--linked`, no se escribió ninguna fila.

## 2. Verificaciones contra producción

### 2.1 Duplicados de email (decisión 3) — **limpio**

El índice nuevo es `UNIQUE (lower(btrim(email)))`. Si hubiera dos perfiles que colisionen bajo ese criterio, la migración fallaría al aplicarse.

| Chequeo | Resultado |
|---|---|
| Grupos de `lower(btrim(email))` con más de un perfil | **0** |
| Grupos de `lower(email)` con más de un perfil | **0** |
| Emails con espacios al borde (`email <> btrim(email)`) | **0** |
| Emails con mayúsculas (`email <> lower(email)`) | **0** |
| Emails nulos | **0** (la columna es `NOT NULL` desde 0001) |
| Duplicados por `lower(email)` en `auth.users` | **0** |
| Perfiles cuyo email normalizado difiere del de `auth.users` | **0** |

→ El `CREATE UNIQUE INDEX` aplica sin conflicto sobre los 27 perfiles actuales.

### 2.2 Delta-only: lo que la migración crea no existe

| Objeto | En producción |
|---|---|
| Función `public.importar_calendario` (cualquier firma) | **No existe** |
| Índice `profiles_email_normalizado_unique` | **No existe** |
| Índices de `profiles` hoy | `profiles_pkey`, `profiles_dni_unique` |
| Última migración aplicada | `0021` (igual que local) |

### 2.3 Lo que la migración lee, tal como está en producción

- `rotation_assignments`: columnas, `UNIQUE (user_id, fecha)`, CHECK `rotation_assignments_motivo_requerido`, sin triggers. Coincide con el relevamiento de INSPECT §2.
- `ausencia_requests`: `user_id`, `fecha_inicio`, `fecha_fin`, `estado approval_status`, `post_aprobacion_tipo`. Son las columnas que usa el predicado de "pisar".
- `pasaje_requests`: `empleado_id`, `dias_viaje date[]`, `estado`, `post_aprobacion_tipo`.
- `post_aprobacion_tipo`: `editada, cancelada`.
- `log_audit(text, text, uuid, jsonb, jsonb)`: owner `postgres`, `SECURITY DEFINER`, `search_path=public`, `proacl = {postgres=X, service_role=X}`. La nueva función la invoca como owner, así que el cierre de 0020 no la afecta.
- `is_admin()` / `auth_role()`: owner `postgres`. Es el owner que la verificación post-push tiene que encontrar en `importar_calendario`.

## 3. La migración, en una tabla

| Elemento | Detalle |
|---|---|
| Índice | `CREATE UNIQUE INDEX profiles_email_normalizado_unique ON public.profiles (lower(btrim(email)))` |
| Función | `public.importar_calendario(p_filas jsonb, p_esperado jsonb) RETURNS jsonb` |
| Molde §6.1 | `SECURITY DEFINER` · `SET search_path = public` · guarda `auth.uid() IS NULL OR NOT is_admin()` → `42501` · `REVOKE ALL … FROM PUBLIC` · `REVOKE ALL … FROM anon` · `GRANT EXECUTE … TO authenticated` |
| Auditoría | Solo `PERFORM public.log_audit(...)`, sin `INSERT` directo a `audit_log` (el drift detector lo verifica sobre `pg_get_functiondef`) |
| Atomicidad | Una llamada = una transacción, sin loteo. Cualquier `RAISE` o error de cast revierte todo |
| Concurrencia | `LOCK TABLE rotation_assignments IN SHARE ROW EXCLUSIVE MODE`, recálculo del plan dentro de la transacción y `40001` si los conteos no coinciden con `p_esperado` |
| Validación en la base | Email resuelve a exactamente un empleado o supervisor activo · sin `(email, fecha)` repetido · rango ≤ 366 días · forma estado/motivo/detalle/notas (la base no tiene CHECK para eso) · detalle ≤ 80 · casts de fecha y enums |
| Escritura | Por conjunto: un `INSERT … ON CONFLICT (user_id, fecha) DO UPDATE` para crear y modificar, un `DELETE` para borrar. Las filas sin cambios no se tocan. `es_estimado = fecha > hoy (AR)` |
| No toca | `ausencia_requests`, `pasaje_requests`, tablas, columnas, enums, RLS |

### Verificación local antes de CI

No hay Docker en la máquina de desarrollo. La función se ejecutó en **PGlite** (Postgres 17 en WASM) contra un stub mínimo de las tablas involucradas: guardas (sin sesión y empleado → `42501`), cada validación (`22023`/`22P02`/`22008`), aborto por conteos (`40001`) con la tabla intacta, escritura y auditoría híbrida (1 resumen + 1 por día pisado, la solicitud intacta), ida y vuelta sin diferencias, 2300 filas en ~70 ms y reimportadas en ~100 ms, e índice → `23505`. La verificación que vale es la de CI, contra Supabase local con todas las migraciones (`tests/integration/calendario-import.test.ts` y `migration.test.ts`).

## 4. Cambio de comportamiento del alta de usuarios (decisión 3)

A partir de 0022, **no pueden existir dos perfiles cuyo email difiera solo en mayúsculas o en espacios al borde**. Un `INSERT` del trigger `handle_new_user`, o un `UPDATE` de `profiles.email`, que choque con el índice falla con `23505`.

Qué ve el admin en Gestión de Usuarios:

- `createUser` chequea antes de crear el usuario de Auth, con `ilike` sin comodines y con `%`, `_` y `\` escapados. Si ya hay un perfil con ese email sin distinguir mayúsculas, devuelve `copy.gestionUsuarios.errors.emailDuplicado`: *"Ya existe un usuario con ese correo electrónico (sin distinguir mayúsculas)."* No queda un usuario de Auth huérfano ni se muestra el error crudo de base.
- Si dos altas del mismo email compiten entre el chequeo y la creación, Auth responde `email_exists` y se devuelve el mismo mensaje es-AR.
- Tests: `tests/unit/gestion-usuarios-actions.test.ts` (4 casos nuevos) y `tests/integration/migration.test.ts` (`23505` sobre una variante en mayúsculas y con espacios).

## 5. Excepción de `audit_log` — **para llevar a la constitución al cerrar el módulo**

> **§6.1 (propuesta de texto):** Toda escritura de calendario registra una fila de `audit_log` por día afectado, **salvo la importación masiva desde Excel** (`importar_calendario`, migración 0022). Esa importación registra **una fila de resumen** por importación (`action = 'calendario_importado'`, `record_id` = `import_id` generado por la función, `new_data` = rango y conteos de filas creadas, modificadas, borradas, sin cambios y pisadas), **más una fila por día solo para los días que pisan una solicitud aprobada y no cancelada** (`action = 'calendario_importado_dia_pisado'`, `record_id` = id de la fila de `rotation_assignments`, estado previo en `old_data`, estado nuevo, `import_id` y las solicitudes que cubrían el día en `new_data`). La excepción está acotada a la importación masiva; toda otra escritura de calendario mantiene la convención por-día. (Decisión de Luciano, 14/09, PRD calendario export/import §4.)

Queda registrada en el encabezado de la migración 0022, en este informe y en la descripción del PR.

## 6. Runbook del push (lo corre Luciano) ⛔

1. **Auditoría previa:** este informe. Repetir §2.1 justo antes del push si pasó tiempo o hubo altas de usuarios:
   ```sql
   SELECT lower(btrim(email)), count(*) FROM public.profiles GROUP BY 1 HAVING count(*) > 1;  -- esperado: 0 filas
   ```
2. **Push:** `supabase db push` (aplica solo 0022).
3. **Verificación de catálogo post-push:**
   ```sql
   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
          pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl::text
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('importar_calendario', 'log_audit', 'is_admin');
   -- esperado importar_calendario: args "p_filas jsonb, p_esperado jsonb", owner postgres,
   --   prosecdef true, proconfig {search_path=public},
   --   proacl {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} (sin anon, sin "=X")
   -- esperado log_audit: sin cambios ({postgres=X/postgres,service_role=X/postgres})

   SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'profiles';
   -- esperado: profiles_pkey, profiles_dni_unique, profiles_email_normalizado_unique (lower(btrim(email)))
   ```
4. **`supabase migration list`:** Local = Remote hasta `0022`.
5. **Regen de tipos, siempre:** `supabase gen types typescript --linked > supabase/types.ts`. En este PR la entrada de `importar_calendario` en `types.ts` está **agregada a mano**, siguiendo el precedente de 0020 / FB-F5-05: `Args: { p_esperado: Json; p_filas: Json }`, `Returns: Json`. La regen tiene que dar **diff cero** contra esa entrada; si no, el diff se commitea y se reporta.
