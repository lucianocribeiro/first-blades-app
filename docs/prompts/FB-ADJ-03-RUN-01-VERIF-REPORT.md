# FB-ADJ-03-RUN-01-VERIF — Informe de verificación de catálogo post-push

- **Fecha:** 2026-08-18
- **Proyecto Supabase:** `simfemdkrkdbumefcxei` (First Blades App)
- **Método:** consultas de solo lectura vía MCP de Supabase (`execute_sql`) + `supabase migration list --linked` + `supabase gen types typescript --linked`. **Ninguna escritura en la base.**
- **Referencia:** `docs/prompts/FB-ADJ-03-RUN-01-SNAPSHOT.md`

**Confirmación previa:** `supabase migration list --linked` muestra Local = Remote hasta **0021**. El push efectivamente corrió.

---

## 1. El tipo `employee_status`

```sql
SELECT enumlabel, enumsortorder FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'employee_status'
ORDER BY enumsortorder;
```

| enumlabel | enumsortorder |
|---|---|
| `activo` | 1 |
| `inactivo` | 2 |

**Exactamente 2 valores, ese orden.** `pendiente` no está.

**Sin tipos huérfanos** — inventario completo de enums del esquema `public`:

```sql
SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace ORDER BY typname;
```
```
approval_status, certificado_tipo, employee_status, estado_dia, motivo_ausencia,
motivo_viaje, notification_type, post_aprobacion_tipo, procedure_estado, user_role
```

10 tipos, los mismos 10 nombres de siempre (drift detector, `migration.test.ts:89-108`). **No hay `employee_status_new` ni ningún tipo de más.** El `DROP TYPE` + `RENAME` de la migración dejó el catálogo limpio: el tipo recreado ocupa exactamente el lugar del original, con el nombre original.

## 2. `profiles.status`

```sql
SELECT column_name, is_nullable, column_default, data_type, udt_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='status';
```

| column_name | is_nullable | column_default | udt_name |
|---|---|---|---|
| `status` | `NO` | `'activo'::employee_status` | `employee_status` |

Comparado **literal** contra el snapshot (`FB-ADJ-03-RUN-01-SNAPSHOT.md`, bloque 2): `is_nullable = NO` (snapshot: `NO` — sin cambios), `column_default = 'activo'::employee_status` (snapshot: idéntico, carácter por carácter — el default sobrevivió a la recreación del tipo), `udt_name = employee_status` (snapshot: idéntico — el tipo quedó con el nombre correcto, no `employee_status_new`).

**Resultado: limpio, sin divergencia.**

## 3. Los datos

```sql
SELECT status, count(*) FROM public.profiles GROUP BY status ORDER BY status;
```

| status | count |
|---|---|
| `activo` | `3` |

Mismo resultado que el snapshot: 3 perfiles, los 3 `activo`. **Ninguna fila perdida ni cambiada** por la recreación del tipo (el `USING status::text::employee_status_new` de la migración preservó los valores).

## 4. Dependencias

```sql
SELECT pg_describe_object(classid, objid, objsubid) AS dependent_object, deptype
FROM pg_depend WHERE refobjid = 'employee_status'::regtype ORDER BY 1;
```

| dependent_object | deptype |
|---|---|
| `column status of table profiles` | `n` |
| `default value for column status of table profiles` | `n` |
| `type employee_status[]` | `i` |

**Idéntico al snapshot** — las mismas 3 dependencias estructurales, nada de más ni de menos.

Confirmado además, contra el tipo ya recreado:
- **Policies de `profiles`:** `profiles_delete_admin`, `profiles_select`, `profiles_update_admin` — mismos 3 nombres que el snapshot, ninguna referencia `status`/`employee_status`.
- **Funciones que referencian `employee_status`:** `[]` (vacío).
- **Vistas que referencian `employee_status` o `profiles`+`status`:** `[]` (vacío).
- **Índices sobre `profiles`:** `profiles_dni_unique`, `profiles_pkey` — mismos 2 que el snapshot, ninguno sobre `status`.
- **CHECK constraints de `profiles`:** `[]` (vacío) — mismo que el snapshot.

## 5. Nada de contrabando

**Migraciones:** `supabase migration list --linked` — Local = Remote hasta `0021`. Nada pendiente.

**Inventario de tablas** (`public`), comparado contra lo esperado:
```
audit_log, ausencia_requests, documents, notification_log, pasaje_requests,
procedures, profiles, rotation_assignments, rotation_groups
```
9 tablas, las mismas de siempre. Nada apareció ni desapareció.

**`approval_status` intacto:**
```sql
SELECT enumlabel, enumsortorder FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'approval_status'
ORDER BY enumsortorder;
```

| enumlabel | enumsortorder |
|---|---|
| `pendiente` | 1 |
| `aprobado` | 2 |
| `rechazado` | 3 |

**Sin cambios.** `pendiente` sigue vivo en `approval_status` — es otro dominio, tal como se esperaba. La migración no lo tocó.

## 6. Regen de `types.ts`

`supabase gen types typescript --linked` con el CLI real (`2.75.0`), contra el proyecto ya con `0021` aplicada.

**Diff contra el archivo commiteado:**

```diff
13c13
<     PostgrestVersion: "14.5"
---
>     PostgrestVersion: "14.15"
```

**No es diff cero.** Una sola línea difiere: `PostgrestVersion`. No es diff de esquema — es la versión del servicio PostgREST del proyecto (metadata de infraestructura, no de ninguna tabla/tipo/columna), que subió de `14.5` a `14.15` en algún momento entre la última regeneración real de `types.ts` y ahora. No tiene relación con la migración `0021` ni con el ajuste `FB-ADJ-03`.

**Confirmado por comparación línea a línea:** las 5 líneas de `employee_status` en el regen (`Row`/`Insert`/`Update` de `profiles` referenciando el enum por nombre, la unión de valores, y el array de `Constants`) son **carácter por carácter idénticas** a lo que edité a mano en el commit `609276f`. La edición manual fue correcta.

**No toqué el archivo.** Reporto el diff tal cual pide el prompt — la corrección del `PostgrestVersion` (si se decide aplicar) es una decisión aparte, no forma parte de este ajuste.

---

## Veredicto

**Producción quedó exactamente como se esperaba.** Los 6 bloques verificados sin divergencia respecto al snapshot, salvo el cambio esperado (`employee_status` de 3 a 2 valores) y sus consecuencias directas (default recreado igual, datos preservados, dependencias sin cambios). `approval_status` intacto, sin contrabando de esquema.

**Única divergencia encontrada:** `PostgrestVersion` en `types.ts` (`14.5` → `14.15`), de infraestructura, no de esquema ni de la migración `0021`. No bloquea el cierre de `FB-ADJ-03` — queda anotada para decidir aparte si se actualiza.
