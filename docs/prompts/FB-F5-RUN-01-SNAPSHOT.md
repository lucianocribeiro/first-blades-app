# FB-F5-RUN-01 — Snapshot pre-push del catálogo (producción)

- **Proyecto Supabase:** `simfemdkrkdbumefcxei` (First Blades App)
- **Fecha:** 2026-08-05
- **Estado en el momento del snapshot:** migración `0019` aplicada (Remote), `0020` presente solo en Local, no aplicada
- **Método:** consultas de solo lectura vía MCP de Supabase (`execute_sql`), contra `pg_proc`, `information_schema`, `pg_constraint`, `pg_policy`, `storage.buckets`

Esta es la foto **de antes**. Sirve como referencia para comparar contra el catálogo real después del `db push`, en `FB-F5-RUN-01-VERIF`.

---

## 1. `log_audit()` — el objeto que el push modifica

```
proname:   log_audit
owner:     postgres
prosecdef: true
proconfig: [search_path=public]
proacl:    anon=X/postgres, authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres
```

⚠️ Confirmado: `anon` y `authenticated` **tienen** `EXECUTE` hoy — este es exactamente el agujero que `0020` cierra (`REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC`). Después del push, el ACL esperado es `postgres=X/postgres, service_role=X/postgres` (sin `anon` ni `authenticated`).

## 2. Molde de funciones hermanas (patrón esperado para las 3 RPCs nuevas)

```
proname:   crear_aprobar_ausencia_admin
owner:     postgres
prosecdef: true
proconfig: [search_path=public]
proacl:    authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres

proname:   resolver_ausencia_request
owner:     postgres
prosecdef: true
proconfig: [search_path=public]
proacl:    authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres
```

Este es el patrón que `crear_procedimiento`, `actualizar_procedimiento` y `archivar_procedimiento` tienen que tener después del push (owner `postgres`, `prosecdef=true`, `search_path=public`, ACL `authenticated + postgres + service_role`, sin `anon`) — ya verificado contra este mismo molde en el drift detector de `migration.test.ts` (CI), pero se re-confirma acá contra el catálogo real de producción en `FB-F5-RUN-01-VERIF`.

## 3. Estado de `procedures` (antes del renombre/CHECK/RLS)

**Columnas** (en inglés — antes del renombre):

| Columna | Tipo | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `title` | `text` | NO | — |
| `content` | `text` | YES | — |
| `storage_path` | `text` | YES | — |
| `category` | `text` | YES | — |
| `created_by` | `uuid` | NO | — |
| `updated_by` | `uuid` | YES | — |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |

**Constraints:**

```sql
PRIMARY KEY (id)                                    -- procedures_pkey
FOREIGN KEY (created_by) REFERENCES profiles(id)     -- procedures_created_by_fkey
FOREIGN KEY (updated_by) REFERENCES profiles(id)     -- procedures_updated_by_fkey
```

Sin CHECK — `procedures_contenido_presente` no existe todavía.

**Policies:**

```sql
-- procedures_select_all (SELECT)
USING (auth.uid() IS NOT NULL)

-- procedures_write_admin (ALL)
USING ((SELECT is_admin()))
WITH CHECK ((SELECT is_admin()))
```

`procedures_select_all` va a desaparecer, reemplazada por `procedures_select`.

**Conteo de filas:**

```
n = 0
```

Confirmado: la tabla sigue vacía.

## 4. Buckets de Storage existentes

```json
[
  {
    "id": "documents",
    "name": "documents",
    "public": false,
    "file_size_limit": 10485760,
    "allowed_mime_types": [
      "image/jpeg", "image/png", "image/webp",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]
  }
]
```

Confirmado: **un solo bucket** (`documents`). El bucket `procedimientos` **no existe** — lo crea el push.

## 5. `profiles.motivo_baja` / `profiles.fecha_baja`

```
[]  -- sin filas: ninguna de las dos columnas existe
```

Confirmado: ausentes.

---

## Resumen

Los cinco puntos coinciden exactamente con lo que la migración `0020` asume como punto de partida (documentado en `docs/prompts/FB-F5-01-INSPECT-REPORT.md`). Nada se movió en producción entre la inspección original y este snapshot.
