# FB-ADJ-03-INSPECT-REPORT — Informe de inspección de solo-lectura (Parte 0)

- **Fecha:** 2026-08-18
- **Rama:** `fase-5/f5-08-gestion-usuarios` @ `263f03a`
- **Proyecto Supabase:** `simfemdkrkdbumefcxei` (First Blades App, `us-east-1`, Postgres 17.6.1)
- **Método:** consultas de solo-lectura vía MCP de Supabase (`execute_sql`) + `supabase migration list --linked` (CLI) + lectura de archivos del repo. **Ninguna migración, `db push`, escritura en la base, ni cambio de código de feature se ejecutó.**
- **Nota de proceso:** este ajuste se entregó primero con el ID `FB-ADJ-01`, ya usado por un ajuste anterior (renombre "Ingreso" + admin auto-envío, PR #37). Corregido a `FB-ADJ-03` antes de versionarse — ver `docs/prompts/FB-ADJ-03-DOC.md`.
- **Nota de acceso:** en el intento inicial de esta inspección, los tres canales de conexión a la base (MCP `execute_sql`, CLI linkeado, conexión directa) fallaron con `28P01 password authentication failed` — la `SUPABASE_DB_PASSWORD` en `.env.local` había quedado inválida. El developer la actualizó; con la password nueva los tres canales autenticaron correctamente y todas las consultas de este informe corrieron **en vivo** contra la base de producción. Ningún dato de este informe es inferido — se marca explícitamente el único punto (bloque 4, ítem sobre `lib/purgatorio.ts`) que es lectura de código, no query.

---

## 1. Enum `employee_status` y columna `profiles.status`

**Confirmado en vivo:**

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

```sql
SELECT column_name, is_nullable, column_default, data_type, udt_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='status';
```

| column_name | is_nullable | column_default | data_type | udt_name |
|---|---|---|---|---|
| `status` | `NO` | `'activo'::employee_status` | `USER-DEFINED` | `employee_status` |

`profiles.status` es `NOT NULL` con default `'activo'`. Coincide con `supabase/migrations/0001_init.sql:10-31`.

## 2. Conteo de filas con `pendiente`

**Confirmado en vivo:**

```sql
SELECT count(*) FILTER (WHERE status = 'pendiente') AS pendiente_count, count(*) AS total_profiles
FROM public.profiles;
```

| pendiente_count | total_profiles |
|---|---|
| `0` | `3` |

```sql
SELECT status, count(*) FROM public.profiles GROUP BY status ORDER BY status;
```

| status | count |
|---|---|
| `activo` | `3` |

Las 3 filas de `profiles` en producción están en `activo`. Ninguna en `inactivo` ni `pendiente`.

## 3. Dependencias del tipo `employee_status`

**Confirmado en vivo — `pg_depend` (la fuente autoritativa: todo objeto que dependa del tipo aparece acá, sin importar dónde esté definido):**

```sql
SELECT pg_describe_object(classid, objid, objsubid) AS dependent_object, deptype
FROM pg_depend
WHERE refobjid = 'employee_status'::regtype
ORDER BY 1;
```

| dependent_object | deptype |
|---|---|
| `column status of table profiles` | `n` (normal) |
| `default value for column status of table profiles` | `n` (normal) |
| `type employee_status[]` | `i` (internal — el array-type automático que Postgres crea para todo enum) |

Solo 3 dependencias, y las 3 son estructurales/automáticas (la columna misma, su default, y el tipo array implícito). **Ningún objeto de negocio depende del tipo.**

Verificado además punto por punto, con consultas específicas — todas **sin resultados**:

**Policies que referencian `status` en `profiles`:**
```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE tablename = 'profiles' ORDER BY policyname;
```
Resultado: 3 policies (`profiles_delete_admin`, `profiles_select`, `profiles_update_admin`), ninguna referencia `status` en su `qual`/`with_check` — usan `is_admin()`, `auth_role()`, `supervisor_id = auth.uid()`. **Confirmado: ninguna policy depende de `employee_status`.**

**Funciones `SECURITY DEFINER` que referencian `employee_status`:**
```sql
SELECT n.nspname, p.proname, p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true
  AND pg_get_functiondef(p.oid) ILIKE '%employee_status%';
```
Resultado: `[]` (vacío). **Sin resultados.**

**Vistas que referencian `employee_status` o `profiles`+`status`:**
```sql
SELECT schemaname, viewname, definition FROM pg_views
WHERE schemaname='public'
  AND (definition ILIKE '%employee_status%' OR definition ILIKE '%profiles%status%');
```
Resultado: `[]` (vacío). **Sin resultados.**

**Índices sobre `profiles`:**
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='profiles' ORDER BY indexname;
```
Resultado: `profiles_dni_unique` (sobre `dni`), `profiles_pkey` (sobre `id`). **Ningún índice sobre `status`.**

**CHECK constraints sobre `profiles`:**
```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
ORDER BY conname;
```
Resultado: `[]` (vacío). **Sin CHECK constraints en `profiles`.**

**Conclusión del bloque:** `employee_status` no tiene ninguna dependencia de negocio — ni policy, ni función `SECURITY DEFINER`, ni vista, ni índice, ni CHECK — que referencie el tipo o sus valores. Es lo que permite que la migración 0021 (achicar el enum a `activo`/`inactivo`) sea un delta puro sobre el tipo y la columna, sin tocar nada más.

## 4. Referencias a `pendiente` en el código (relacionadas con `employee_status`)

Grep sobre `app/`, `lib/`, `components/`, `supabase/migrations/` (lectura de código, no query):

| Archivo:línea | Contenido | Relevancia |
|---|---|---|
| `app/(app)/equipo/EquipoTable.tsx:24` | `{ value: 'pendiente', label: copy.status.pendiente }` | Opción de filtro por `employee_status` en la tabla de Equipo — **muerta**, nunca hay filas en ese estado (bloque 2). A eliminar con la migración. |
| `app/(app)/mi-perfil/ProfileEditForm.tsx:19` | `{ value: 'pendiente', label: copy.status.pendiente }` | Mismo patrón, en el form de edición de perfil (uso interno/lectura, no escribe `status`). A eliminar. |
| `app/(app)/equipo/EquipoTable.tsx:76`, `app/(app)/mi-equipo/page.tsx:74`, `app/(app)/mi-equipo/[id]/page.tsx:105` | `<StatusBadge status={... as Enums<'employee_status'>} />` | Consumen el tipo `employee_status` para el badge — siguen funcionando igual con un enum de 2 valores, no requieren cambio. |
| `lib/db-types.ts:8` | `export type EmployeeStatus = Enums<'employee_status'>;` | Alias estable — no requiere cambio de nombre, solo se regenera desde `supabase/types.ts` tras la migración. |
| `app/(app)/mi-perfil/actions.ts:108` | `estado: 'pendiente'` | **No es `employee_status`** — es un insert en la tabla `documents` (columna `estado approval_status`, ver comentario línea 97). Falso positivo del grep por nombre de valor compartido entre enums; no depende de `employee_status`. |
| `lib/purgatorio.ts:4,7` | `type PurgatoryStatus = Enums<'approval_status'>` / `isPending` | *(lectura de código, no query)* Opera sobre `approval_status`, no sobre `employee_status` — confirma que el 'pendiente' del flujo de purgatorio (documentos, ausencias, pasajes) es un tipo completamente distinto y **no se ve afectado** por achicar `employee_status`. |
| `supabase/types.ts:466,484,502,710,870` | `employee_status: "activo" \| "inactivo" \| "pendiente"` (tipo generado) | Se regenera automáticamente con `supabase gen types typescript --linked` tras la migración 0021 — no se edita a mano (CLAUDE.md). |
| `supabase/migrations/0001_init.sql:10` | `CREATE TYPE employee_status AS ENUM ('activo', 'inactivo', 'pendiente');` | Definición original — no se edita (las migraciones son inmutables); 0021 la corrige hacia adelante con `ALTER TYPE`. |

**Ningún código de aplicación escribe `profiles.status = 'pendiente'`.** Las únicas escrituras a `profiles.status` son `'activo'` explícito en alta (FB-F5-08) y `'inactivo'` en baja — consistente con el conteo en vivo del bloque 2.

## 5. Todo lo relacionado con "Ingreso" / `formularios`

| Archivo:línea | Contenido |
|---|---|
| `lib/roles.ts:16` | `\| 'formularios'` (tipo de key de módulo) |
| `lib/roles.ts:29` | `formularios: ['admin', 'supervisor', 'empleado']` (visibilidad por rol) |
| `lib/copy/index.ts:57-59` | Comentario `// FB-ADJ-01: renombre de etiqueta únicamente...` + `formularios: 'Ingreso'` (label del nav) |
| `lib/copy/index.ts:113` | `ingreso: 'Ingreso'` |
| `lib/copy/index.ts:1026-1027` | `formularios: { title: 'Ingreso', ... }` (copy de la página) |
| `components/layout/Sidebar.tsx:39` | Ítem de sidebar `key: 'formularios'`, `href: '/formularios'`, label `copy.nav.formularios` |
| `components/layout/Topbar.tsx:33` | `formularios: { title: copy.pages.formularios.title, ... }` |
| `app/(app)/formularios/page.tsx` | Ruta placeholder (Fase 0), contenido "próximamente" — sin cambios previstos |

Todo consistente con lo documentado: el renombre de etiqueta "Formularios" → "Ingreso" (FB-ADJ-01) tocó solo copy/labels; la ruta interna (`/formularios`) y el key (`'formularios'`) quedaron sin cambiar deliberadamente. No hay ninguna referencia a "Ingreso"/`formularios` relacionada con `employee_status` — son dominios independientes; se listan acá solo porque el ajuste anterior con el mismo ID incorrecto (FB-ADJ-01) tocó este módulo, para que quede claro que **este** ajuste (FB-ADJ-03) no lo toca.

## 6. Estado de migraciones y hueco del drift detector

**Confirmado en vivo — `supabase migration list --linked`:**

```
 Local | Remote | Time (UTC)
-------|--------|------------
 0001  | 0001   | 0001
 0002  | 0002   | 0002
 ...
 0019  | 0019   | 0019
 0020  | 0020   | 0020
```

Local = Remote en `0020` (última migración aplicada, `0020_fase5_procedimientos.sql`). La base está al día; `0021` sería la próxima migración sin conflicto de numeración.

**Hueco del drift detector** — lectura de código, `tests/integration/migration.test.ts:89-108`:

```ts
it('enums de dominio existen (incluye certificado_tipo de 0002)', async () => {
  const { rows } = await client.query(`
    SELECT typname FROM pg_type
    WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
    ORDER BY typname
  `);
  const names = rows.map((r) => r.typname).sort();
  expect(names).toEqual([
    'approval_status', 'certificado_tipo', 'employee_status', 'estado_dia',
    'motivo_ausencia', 'motivo_viaje', 'notification_type',
    'post_aprobacion_tipo', 'procedure_estado', 'user_role',
  ]);
});
```

Este test solo verifica que exista un tipo llamado `employee_status` — no sus valores. Compárese con `certificado_tipo` (línea 111-123), `post_aprobacion_tipo` (línea 856-866) y `procedure_estado` (línea 1032-1039), que sí tienen un test dedicado a los valores exactos, en orden, del enum. **`employee_status` es el único enum de dominio sin ese test de valores exactos** — es el hueco que permite que la migración 0021 cambie los valores del tipo sin que ningún test lo detecte, y la razón por la que el ajuste pide agregarlo.

---

## Resumen para la migración 0021

- Enum a achicar: `activo`, `inactivo` (quitar `pendiente` — 0 filas lo usan, confirmado en vivo).
- Sin dependencias de negocio que migrar (bloque 3): no hay policy, función, vista, índice ni CHECK que tocar además del tipo y la columna.
- Limpieza de código acompañante (bloque 4): quitar las 2 opciones `'pendiente'` muertas en `EquipoTable.tsx:24` y `ProfileEditForm.tsx:19`.
- Agregar a `tests/integration/migration.test.ts` un test de valores exactos para `employee_status`, igual que los de `certificado_tipo`/`post_aprobacion_tipo`/`procedure_estado` (bloque 6).
- Regenerar `supabase/types.ts` y actualizar `lib/db-types.ts` si corresponde, tras aplicar 0021 (convención del repo).
