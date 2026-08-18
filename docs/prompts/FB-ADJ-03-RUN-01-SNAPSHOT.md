# FB-ADJ-03-RUN-01 — Snapshot pre-push del catálogo (producción)

- **Proyecto Supabase:** `simfemdkrkdbumefcxei` (First Blades App)
- **Fecha:** 2026-08-18
- **Estado en el momento del snapshot:** migración `0020` aplicada (Remote), `0021` presente solo en Local, no aplicada
- **Método:** consultas de solo lectura vía MCP de Supabase (`execute_sql`), contra `pg_enum`, `information_schema.columns`, `pg_depend`, `pg_policies`, `pg_proc`, `pg_indexes`, `pg_constraint`

Esta es la foto **de antes**. Sirve como referencia para comparar contra el catálogo real después del `db push`, en `FB-ADJ-03-RUN-01-VERIF`.

---

## 1. `employee_status` — valores y orden

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
| `pendiente` | 3 |

Todavía 3 valores — el push no corrió. Después de `0021` tiene que quedar en exactamente `activo`, `inactivo` (2 valores, ese orden).

## 2. `profiles.status` — tipo, nullabilidad, default (literal)

```sql
SELECT column_name, is_nullable, column_default, data_type, udt_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='status';
```

| column_name | is_nullable | column_default | data_type | udt_name |
|---|---|---|---|---|
| `status` | `NO` | `'activo'::employee_status` | `USER-DEFINED` | `employee_status` |

Esto es lo que tiene que **reaparecer idéntico** después del push: `NOT NULL`, default literal `'activo'::employee_status`, `udt_name = 'employee_status'` (el tipo recreado se renombra de vuelta al nombre original).

## 3. Conteo por estado (precondición reverificada)

```sql
SELECT status, count(*) FROM public.profiles GROUP BY status ORDER BY status;
```

| status | count |
|---|---|
| `activo` | `3` |

**Cero filas en `pendiente`.** Mismo resultado que la inspección original (`FB-ADJ-03-INSPECT-REPORT.md`, 2026-08-18 más temprano el mismo día) — nada cambió en producción entre medio. Precondición para el push: **cumplida**.

## 4. Dependencias del tipo — `pg_depend` completo

```sql
SELECT pg_describe_object(classid, objid, objsubid) AS dependent_object, deptype
FROM pg_depend
WHERE refobjid = 'employee_status'::regtype
ORDER BY 1;
```

| dependent_object | deptype |
|---|---|
| `column status of table profiles` | `n` |
| `default value for column status of table profiles` | `n` |
| `type employee_status[]` | `i` |

Idéntico a la inspección original: 3 dependencias, las 3 estructurales. Esta es la lista a comparar después del push — si aparece cualquier objeto nuevo o distinto de estos 3 (con el tipo ya renombrado), algo no recreó limpio.

## 5. Confirmación — sin policies, funciones, vistas, índices ni checks sobre el tipo

**Policies de `profiles`:**
```sql
SELECT schemaname, tablename, policyname FROM pg_policies WHERE tablename = 'profiles' ORDER BY policyname;
```
→ `profiles_delete_admin`, `profiles_select`, `profiles_update_admin` — ninguna referencia `status`/`employee_status` (usan `is_admin()`, `auth_role()`, `supervisor_id`).

**Funciones `SECURITY DEFINER` que referencian `employee_status`:**
```sql
SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true AND pg_get_functiondef(p.oid) ILIKE '%employee_status%';
```
→ `[]` (vacío).

**Índices sobre `profiles`:**
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='profiles' ORDER BY indexname;
```
→ `profiles_dni_unique` (sobre `dni`), `profiles_pkey` (sobre `id`) — ninguno sobre `status`.

**CHECK constraints de `profiles`:**
```sql
SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' ORDER BY conname;
```
→ `[]` (vacío).

Confirmado: nada de esto cambió respecto a la inspección original.

## 6. Estado de migraciones

```
supabase migration list --linked
```

Local = Remote hasta `0020`. `0021` presente solo en Local. Ninguna otra migración pendiente.

---

## Resumen

Los seis puntos coinciden exactamente con lo documentado en `docs/prompts/FB-ADJ-03-INSPECT-REPORT.md`. Nada se movió en producción entre la inspección original y este snapshot, horas antes del push. **Recomendación: avanzar.**
