# FB-F5-RUN-01-VERIF — Informe de verificación de catálogo post-push

- **Fecha:** 2026-08-06
- **Proyecto Supabase:** `simfemdkrkdbumefcxei` (First Blades App)
- **Método:** consultas de solo lectura vía MCP de Supabase (`execute_sql`, `list_extensions`, `get_advisors`) + `supabase migration list` + `supabase gen types typescript --linked`. **Ninguna escritura en la base.**
- **Referencia:** `docs/prompts/FB-F5-RUN-01-SNAPSHOT.md`

**Confirmación previa:** `supabase migration list` muestra Local = Remote hasta **0020**. El push efectivamente corrió.

---

## 1. `log_audit()` — el objeto que cambió

```
proowner:  postgres   (snapshot: postgres — SIN CAMBIOS)
prosecdef: true        (snapshot: true — SIN CAMBIOS)
proconfig: [search_path=public]   (snapshot: igual — SIN CAMBIOS)
proacl:    postgres=X/postgres, service_role=X/postgres
           (snapshot: anon=X/postgres, authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres
            → anon y authenticated CAYERON. Es el único cambio esperado.)
```

**Cuerpo de la función** (`pg_get_functiondef`), comparado contra el snapshot:

```sql
CREATE OR REPLACE FUNCTION public.log_audit(p_action text, p_table_name text, p_record_id uuid, p_old_data jsonb DEFAULT NULL::jsonb, p_new_data jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (auth.uid(), p_action, p_table_name, p_record_id, p_old_data, p_new_data);
END;
$function$
```

Idéntico al snapshot, carácter por carácter. **Resultado: limpio.** El único cambio fue el `proacl`, exactamente como se esperaba.

Consistente además con el advisor de seguridad: `log_audit` **ya no aparece** en los hallazgos de `anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` — antes del push aparecía en ambos.

## 2. Las tres RPCs nuevas

```
crear_procedimiento:
  proowner:  postgres
  prosecdef: true
  proconfig: [search_path=public]
  proacl:    authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres

actualizar_procedimiento:
  proowner:  postgres
  prosecdef: true
  proconfig: [search_path=public]
  proacl:    authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres

archivar_procedimiento:
  proowner:  postgres
  prosecdef: true
  proconfig: [search_path=public]
  proacl:    authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres
```

Las tres coinciden **exactamente** con el molde del snapshot (`resolver_ausencia_request` / `crear_aprobar_ausencia_admin`): mismo owner, mismo `prosecdef`, mismo `search_path`, misma forma de ACL (`authenticated + postgres + service_role`, sin `anon`). `service_role` presente sin que `0020` lo otorgue explícito — confirmado el mismo patrón de `ALTER DEFAULT PRIVILEGES` de plataforma que ya se veía en las funciones hermanas.

El advisor de seguridad marca (nivel `WARN`, no bloqueante) que las tres son ejecutables por `authenticated` vía REST — **esperado y correcto**: es el diseño (guarda `is_admin()` interna, no a nivel de grant), el mismo patrón que ya tienen `resolver_ausencia_request`, `crear_aprobar_ausencia_admin`, etc.

**Resultado: limpio.**

## 3. `procedures`

**Columnas** (orden real de la tabla):

| Columna | Tipo | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `titulo` | `text` | NO | — |
| `contenido_texto` | `text` | YES | — |
| `file_path` | `text` | YES | — |
| `categoria` | `text` | YES | — |
| `created_by` | `uuid` | NO | — |
| `updated_by` | `uuid` | YES | — |
| `created_at` | `timestamptz` | NO | `now()` |
| `updated_at` | `timestamptz` | NO | `now()` |
| `estado` | `procedure_estado` | **NO** | `'vigente'::procedure_estado` |

Ninguna columna vieja (`title`/`content`/`storage_path`/`category`) presente.

**Enum `procedure_estado`:** `vigente`, `archivado` — exactamente 2 valores, en ese orden.

**CHECK `procedures_contenido_presente`** (transcripción literal vía `pg_get_constraintdef`):

```sql
CHECK ((((contenido_texto IS NOT NULL) AND (contenido_texto !~ '^[[:space:]]*$'::text)) OR ((file_path IS NOT NULL) AND (file_path !~ '^[[:space:]]*$'::text))))
```

Simétrico, con la regex `[[:space:]]` en las dos ramas — coincide con el fix de `FB-F5-04`.

**Policies** (transcripción literal):

```sql
-- procedures_select (SELECT)
USING (( SELECT is_admin() AS is_admin) OR (estado = 'vigente'::procedure_estado))

-- procedures_write_admin (ALL)
USING ( SELECT is_admin() AS is_admin)
WITH CHECK ( SELECT is_admin() AS is_admin)
```

`procedures_select_all` **no existe** — confirmado.

**Conteo de filas:** `0`.

**Resultado: limpio.**

## 4. Storage

**Bucket `procedimientos`:**

```json
{
  "id": "procedimientos",
  "public": false,
  "file_size_limit": 10485760,
  "allowed_mime_types": [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain"
  ]
}
```

**Policies de `storage.objects` para `procedimientos`** (transcripción literal):

```sql
-- storage_procedimientos_select (SELECT)
USING ((bucket_id = 'procedimientos') AND (auth.uid() IS NOT NULL))

-- storage_procedimientos_insert (INSERT)
WITH CHECK ((bucket_id = 'procedimientos') AND ( SELECT is_admin() AS is_admin))

-- storage_procedimientos_update (UPDATE)
USING ((bucket_id = 'procedimientos') AND ( SELECT is_admin() AS is_admin))
WITH CHECK ((bucket_id = 'procedimientos') AND ( SELECT is_admin() AS is_admin))

-- storage_procedimientos_delete (DELETE)
USING ((bucket_id = 'procedimientos') AND ( SELECT is_admin() AS is_admin))
```

Lectura abierta a cualquier autenticado, escritura (INSERT/UPDATE/DELETE) solo admin — exactamente lo esperado.

**Bucket `documents`:** sin cambios respecto del snapshot (mismo `public`, `file_size_limit`, `allowed_mime_types`).

**Resultado: limpio.**

## 5. `profiles`

`motivo_baja` (`text`, nullable) y `fecha_baja` (`date`, nullable) presentes. El resto de las columnas (`id`, `email`, `full_name`, `role`, `status`, `supervisor_id`, `phone`, `dni`, `fecha_ingreso`, `entrevista_tecnica`, `created_at`, `updated_at`, `cuit`, `winda_id`) sin cambios respecto del snapshot — mismo orden, mismos tipos.

**Resultado: limpio.**

## 6. Nada de contrabando

**Enums (`public`), inventario completo:**

```
approval_status, certificado_tipo, employee_status, estado_dia, motivo_ausencia,
motivo_viaje, notification_type, post_aprobacion_tipo, procedure_estado, user_role
```

10 enums — los 9 previos + `procedure_estado`. Nada más apareció ni desapareció.

**Tablas (`public`), inventario completo:**

```
audit_log, ausencia_requests, documents, notification_log, pasaje_requests,
procedures, profiles, rotation_assignments, rotation_groups
```

9 tablas — el mismo set de siempre. Ninguna tabla nueva ni eliminada (el bucket de Storage no es una tabla, vive en `storage.buckets`).

**Funciones (`public`), inventario completo:**

```
actualizar_procedimiento, archivar_procedimiento, auth_role,
cancelar_editar_ausencia_aprobada, cancelar_editar_pasaje_aprobado,
crear_aprobar_ausencia_admin, crear_aprobar_pasaje_admin, crear_procedimiento,
handle_new_user, is_admin, log_audit, resolver_ausencia_request,
resolver_pasaje_request
```

13 funciones — las 10 previas + las 3 RPCs nuevas de `0020`. Nada más apareció.

**Buckets de Storage, inventario completo:** `documents`, `procedimientos`. Ninguno más.

**RLS deshabilitada en alguna tabla de `public`:** `0` filas — ninguna tabla perdió RLS.

**`migration list`:** Local = Remote hasta `0020`, sin ninguna migración pendiente ni inesperada.

**Resultado: limpio. Sin contrabando.**

## 7. Regen de `types.ts` — ⚠️ NO es diff cero

Corrido con el CLI real (`supabase gen types typescript --linked`), linkeado al proyecto (`simfemdkrkdbumefcxei`), contra `main` limpio.

**El diff completo (2 divergencias, en `Args` de dos de las tres RPCs nuevas):**

```diff
606,608c606,608
<           p_categoria: string | null
<           p_contenido_texto: string | null
<           p_file_path: string | null
---
>           p_categoria: string
>           p_contenido_texto: string
>           p_file_path: string
666,668c666,668
<           p_categoria: string | null
<           p_contenido_texto: string | null
<           p_file_path: string | null
---
>           p_categoria: string
>           p_contenido_texto: string
>           p_file_path: string
```

(`<` = `supabase/types.ts` commiteado; `>` = regen real del CLI. La primera sección corresponde a `actualizar_procedimiento`, la segunda a `crear_procedimiento`.)

**Qué significa:** al editar `supabase/types.ts` a mano en `FB-F5-02` (sin Docker local, sin poder correr el regen real), asumí que como las columnas `categoria`/`contenido_texto`/`file_path` son nullable en la tabla, los parámetros `p_categoria`/`p_contenido_texto`/`p_file_path` de las RPCs debían tipar `string | null`. Eso está mal: en el SQL real, esos tres parámetros están declarados `TEXT` **sin `DEFAULT`**, y el generador de Supabase no les agrega `| null` — los tipa como `string` a secas (requerido, no-nullable en TypeScript), aunque en tiempo de ejecución Postgres sí acepte pasarles `NULL`.

**Impacto:** no afecta el `db push` en sí ni el comportamiento real de las RPCs (ambas formas compilan contra el mismo SQL, que sí acepta `NULL` en runtime). El impacto es solo en el **tipado TypeScript**: con el archivo commiteado hoy, un caller de `FB-F5-05` podría escribir `supabase.rpc('crear_procedimiento', { p_categoria: null, ... })` y el compilador lo aceptaría; con el tipo real (`string`), eso sería un error de tipos — hay que pasar `undefined` u omitir el default, no `null`, o el código de la Server Action debe pasar siempre un string (aunque sea `''`).

**No toqué `supabase/types.ts`.** Queda tal cual está commiteado, con esta divergencia documentada acá, a la espera de instrucciones (el fix es un `find & replace` de 6 líneas, pero corresponde a un prompt de build aparte, no a esta verificación).

`archivar_procedimiento` (único parámetro `TEXT`-relevante: `p_estado public.procedure_estado`, un enum, no `TEXT`) **no tiene divergencia** — coincide exacto.

---

## Confirmación de alcance respetado

- ❌ Ninguna escritura en la base (todas las consultas fueron de solo lectura contra catálogo/`information_schema`; el regen de `types.ts` también es de solo lectura).
- ❌ `supabase/types.ts` no se modificó.
- ✅ Único archivo nuevo: este informe y el prompt versionado.

---

## Veredicto: producción quedó **exactamente como se esperaba**, con una salvedad de tooling (no de base de datos)

Los 6 bloques que verifican el **catálogo real de producción** (bloques 1–6) están **100% limpios**: el `REVOKE` de `log_audit()` es el único cambio en esa función, las 3 RPCs nuevas calzan con el molde esperado en owner/seguridad/ACL, `procedures`/`profiles`/Storage quedaron exactamente como diseñó `0020`, y no apareció ni desapareció nada fuera de lo declarado en la migración.

La única divergencia (bloque 7) es en `supabase/types.ts`, un artefacto del repo, no del catálogo de la base — y es exactamente el tipo de cosa para la que existía la nota de tooling desde `FB-F5-02`: la edición a mano sin Docker local tenía un margen de error, y el regen real lo encontró. **No es el escenario de "frenar y no tocar nada" de una función `SECURITY DEFINER`** (eso dio limpio) — es una corrección de tipos pendiente, de bajo riesgo, para un prompt de build aparte.
