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
| Molde §6.1 | `SECURITY DEFINER` · `SET search_path = public` · guarda **afirmativa** `auth.uid() IS NULL OR is_admin() IS NOT TRUE` → `42501` (NULL = no-admin; corregido en FB-PI-11-C) · `REVOKE ALL … FROM PUBLIC` · `REVOKE ALL … FROM anon` · `GRANT EXECUTE … TO authenticated` |
| Auditoría | Solo `PERFORM public.log_audit(...)`, sin `INSERT` directo a `audit_log` (el drift detector lo verifica sobre `pg_get_functiondef`) |
| Atomicidad | Una llamada = una transacción, sin loteo. Cualquier `RAISE` o error de cast revierte todo |
| Concurrencia | `LOCK TABLE rotation_assignments IN SHARE ROW EXCLUSIVE MODE`, recálculo del plan dentro de la transacción y SQLSTATE propio `FBC01` si los conteos no coinciden con `p_esperado` (ver nota abajo) |
| Validación en la base | Email resuelve a exactamente un empleado o supervisor activo · sin `(email, fecha)` repetido · rango ≤ 366 días · ventana `2020-01-01` a hoy + 2 años (FB-PI-11-C) · forma estado/motivo/detalle/notas (la base no tiene CHECK para eso) · detalle ≤ 80 · casts de fecha y enums |
| Escritura | Por conjunto: un `INSERT … ON CONFLICT (user_id, fecha) DO UPDATE` para crear y modificar, un `DELETE` para borrar. Las filas sin cambios no se tocan. `es_estimado = fecha > hoy (AR)` |
| No toca | `ausencia_requests`, `pasaje_requests`, tablas, columnas, enums, RLS |

### Nota: por qué `FBC01` y no `40001`

La primera versión abortaba con `40001` (serialization_failure). En CI, el test de concurrencia **se colgó** (timeout de 30 s): PostgREST trata la clase 40 como transitoria y **reintenta la transacción sin fin**. Es un bug conocido de PostgREST 14, corregido en 16 ([Supabase: infinite transaction retries con 40001 en RPC](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)). Producción corre PostgREST 14.x (`supabase/types.ts`: `PostgrestVersion: "14.15"`), así que el bucle con CPU alta habría pasado en producción en cada confirmación desactualizada. Se cambió a un SQLSTATE propio fuera de la clase 40 (`FBC01`), que PostgREST no reintenta y devuelve tal cual en `error.code`. El test de integración lo cubre: la RPC responde con `FBC01` y no deja nada escrito.

### Verificación local antes de CI

No hay Docker en la máquina de desarrollo. La función se ejecutó en **PGlite** (Postgres 17 en WASM) contra un stub mínimo de las tablas involucradas: guardas (sin sesión y empleado → `42501`), cada validación (`22023`/`22P02`/`22008`), aborto por conteos con la tabla intacta, escritura y auditoría híbrida (1 resumen + 1 por día pisado, la solicitud intacta), ida y vuelta sin diferencias, 2300 filas en ~70 ms y reimportadas en ~100 ms, e índice → `23505`. La verificación que vale es la de CI, contra Supabase local con todas las migraciones (`tests/integration/calendario-import.test.ts` y `migration.test.ts`).

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

## 7. Correcciones de FB-PI-11-C (hallazgos de `FB-PI-AUD-11`)

| # | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| 1 (bloqueante) | La guarda `NOT is_admin()` dejaba pasar `is_admin()` NULL (JWT `authenticated` sin perfil) | Guarda afirmativa: `auth.uid() IS NULL OR is_admin() IS NOT TRUE`. Verificado en PGlite: con la guarda vieja, un `sub` sin perfil **importaba**; con la nueva, `42501` | Integración: JWT sin perfil → `42501` por PostgREST y por Postgres directo, nada escrito |
| 2 | La RPC no revalidaba la ventana de fechas | `v_desde < 2020-01-01` o `v_hasta > hoy + 2 años` → `22023`. La app calcula hoy + 2 años igual que Postgres (`sumarAnios`: 29/02 → 28/02) | Integración: cada límite rechazado llamando a la RPC directo; los bordes son válidos |
| 3 | `borrados` y `pisados` se cortaban en 500 sin aviso | Sin topes: las listas viajan completas, también los errores, y se recorren con scroll dentro de cada bloque | Unit: 600 borrados y 600 pisados vuelven completos |
| 4 | El test del `40001` era textual | Se reemplazó por la ruta de aborto **ejercitada** contra Postgres directo (código `FBC01`, nunca clase 40), además del test por PostgREST | Integración |
| 5 | El alta no usaba la normalización del índice | `lib/normalizar-email.ts`: espejo exacto de `lower(btrim())`, que **solo recorta espacios**, no tabs (el `trim()` anterior no era equivalente). Lo usan el alta y el import. El alta compara la clave contra todos los perfiles (`fetchAllRows`), mapea `email_exists`, el error genérico del trigger (re-chequeando la clave) y `23505` a `emailDuplicado` | Unit (mayúsculas y espacios en input y en valor almacenado, tab, paginación, carreras, `23505`) + integración (paridad contra `lower(btrim())` de Postgres real) |

### Hallazgo 1, fuera de 0022: el mismo patrón en 9 funciones ya en producción

`IF auth.uid() IS NULL OR NOT public.is_admin()` está en **9 funciones vivas** (catálogo de producción, solo lectura): `resolver_ausencia_request`, `resolver_pasaje_request`, `cancelar_editar_ausencia_aprobada`, `cancelar_editar_pasaje_aprobado`, `crear_aprobar_ausencia_admin`, `crear_aprobar_pasaje_admin`, `crear_procedimiento`, `actualizar_procedimiento` y `archivar_procedimiento` (0013–0020).

- **Hoy no es explotable:** hay 0 usuarios de Auth sin perfil, y `handle_new_user` crea el perfil en cada alta.
- **Ventana real:** un usuario purgado (perfil y Auth borrados, como en FB-PI-06) cuyo JWT siga vigente, hasta 1 h. Durante esa ventana podría invocar esas RPCs de admin.
- **No se tocó:** esas funciones no son parte de este trabajo, y corregirlas amplía el alcance de 0022. Queda como decisión de Luciano: sumarlas a 0022 antes del push, o hacer una migración aparte.
