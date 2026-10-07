# FB-PI-11-RUN-VERIF — `db push` de la migración 0022 y verificación post-push

- **Fecha:** 2026-10-07
- **Prompt:** `docs/prompts/FB-PI-11-F.md`
- **Proyecto:** `simfemdkrkdbumefcxei` (producción)
- **Rama / cabeza aplicada:** `feat/fb-pi-11-import-calendario` @ `8e732ed` (CI verde en los tres jobs)
- **Runbook:** `docs/audits/FB-PI-11-SCHEMA-PREPUSH.md` §6
- **Ejecutó:** Claude Code, con autorización explícita de Luciano para el push (primera aplicación de la regla nueva de FB-PI-11-F, ver §5)

---

## 1. Acciones que tocaron producción

| Hora (UTC) | Acción | Tipo |
|---|---|---|
| 19:16 | Query de duplicados de email + última migración | Solo lectura |
| ~19:17 | `supabase migration list` · `supabase db push --dry-run` | Solo lectura |
| **19:18:05–19:18:08** | **`supabase db push`, autorizado por Luciano ("autorizo el push")** | **Escritura: aplica 0022** |
| ~19:19 | Catálogo a–g (MCP) · `supabase migration list` · `supabase gen types --linked` (×2) | Solo lectura |

## 2. Compuertas previas (Paso 0)

| # | Compuerta | Resultado |
|---|---|---|
| 1 | Duplicados de `lower(btrim(email))` | **0** (27 perfiles), última migración `0021` |
| 2 | `migration list` | `0001`–`0021` Local = Remote; `0022` solo en Local |
| 3 | `db push --dry-run` | `Would push these migrations: • 0022_import_calendario.sql` (solo esa) |
| 4 | Rama y cabeza | `8e732ed` = remoto = cabeza del PR #56, CI verde |

## 3. Salida completa del push

```
Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 0022_import_calendario.sql

 [Y/n] Y
Applying migration 0022_import_calendario.sql...
Finished supabase db push.
A new version of Supabase CLI is available: v2.120.0 (currently installed v2.75.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
```

Exit code `0`. CLI 2.75.0.

## 4. Verificación de catálogo (queries a–g del runbook)

| Query | Esperado | Obtenido | |
|---|---|---|---|
| a) firma | `p_filas jsonb, p_esperado jsonb` → `jsonb` | `p_filas jsonb, p_esperado jsonb` → `jsonb` | ✅ |
| a) owner | `postgres` | `postgres` | ✅ |
| a) prosecdef | `true` | `true` | ✅ |
| a) proconfig | `{search_path=public}` | `["search_path=public"]` | ✅ |
| a) proacl | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` | idéntico (sin `anon=X`, sin `=X/postgres`) | ✅ |
| b) EXECUTE efectivo | authenticated `true` · anon `false` · public `false` | `true` · `false` · `false` | ✅ |
| c) guarda | afirmativa (`is_admin() IS NOT TRUE`), sin `NOT public.is_admin()` | afirmativa `true` · por negación `false` | ✅ |
| d) owners | `postgres` en `importar_calendario`, `is_admin`, `auth_role`, `log_audit` | `postgres` en las cuatro | ✅ |
| e) `log_audit` | `{postgres=X/postgres,service_role=X/postgres}` (sin cambios) | idéntico | ✅ |
| f) índice | `indisunique = true`, `… USING btree (lower(btrim(email)))` | `true`, `CREATE UNIQUE INDEX profiles_email_normalizado_unique ON public.profiles USING btree (lower(btrim(email)))` | ✅ |
| g) sin cambios de datos | triggers 0 · calendario 0 · audit 19 | 0 · 0 · 19 (27 perfiles, última migración `0022`) | ✅ |

**Sin desvíos.**

## 5. Cierre del runbook

- **`supabase migration list`:** `0001`–`0022` en Local **y** Remote, sin huecos. ✅
- **Regen de `types.ts --linked`:** hubo diff, y **ninguna línea del diff es de esquema**. La entrada de `importar_calendario` agregada a mano en el PR coincide exactamente con la generada (`Args: { p_esperado: Json; p_filas: Json }`, `Returns: Json`). Las 22 líneas que cambian son:
  - `PostgrestVersion: "14.15"` → `"14.5"`.
  - Paréntesis en las condiciones de los helpers genéricos (`Tables`, `TablesInsert`, `TablesUpdate`, `Enums`, `CompositeTypes`): solo formato del generador.

  Se commitea el archivo regenerado: es la fuente de verdad (FB-PI-11-F). Con él: typecheck limpio, lint limpio, 956 tests unitarios verdes, y **un segundo regen inmediato da diff cero**.

  **Observación sobre `PostgrestVersion`:** `0f67dde` (FB-ADJ-03-RUN-01-VERIF) había movido este valor en la dirección contraria, de 14.5 a 14.15. Que el mismo dato oscile entre regens sugiere que ese commit se generó por otro camino (el formato sin paréntesis es el del generador de la API o el MCP, no el de la CLI 2.75). Desde hoy el archivo queda alineado con la CLI 2.75 del runbook. Para el bug de reintentos con `40001` es indistinto: las dos versiones son 14.x y el bug se corrigió en 16. Si se quiere fijar cuál es la versión real de PostgREST del proyecto, es una consulta aparte.

## 6. Regla nueva para la constitución §2.3 (registrar al cerrar el item)

> **§2.3 (propuesta de texto):** Desde FB-PI-11-F, el `supabase db push` lo **ejecuta Claude Code**, en todas las migraciones, para que una sola mano opere el repositorio y la base. El gate no cambia: todo push pasa por el runbook, y la pausa deliberada entre el plan y la escritura en producción es la **autorización explícita de Luciano en el momento**, paso por paso. La autorización de un paso no autoriza el siguiente: el push, el merge y cualquier otra escritura en producción se autorizan por separado. Ante cualquier desvío en la verificación post-push, se frena y se reporta; nunca se corrige improvisando sobre producción.
