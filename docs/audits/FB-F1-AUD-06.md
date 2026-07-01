# FB-F1-AUD-06 — Auditoria de mapeo: full_name + busqueda de empleados

## 1. Resumen

Se confirma el diagnostico funcional: la creacion y gestion de usuarios escriben `profiles.full_name`, pero Mi Perfil, admin-empleado, aprobaciones y `searchEmployees` leen o matchean `nombre`/`apellido`. Para usuarios creados por la app, esos campos no se poblan, por lo que el selector no encuentra por nombre y las vistas caen a "Sin datos" o email.

Tambien se confirma el error tragado en `searchEmployees`: la accion destructura solo `data`, ignora `error` y devuelve `[]`, haciendo indistinguible un fallo de query de una busqueda sin resultados. En la misma ruta hay otro patron similar en `getSignedUrls`, que descarta el error del filtro de documentos visibles.

Verificacion de datos: en el Supabase configurado por `.env.local`, `profiles` tiene 2 filas y 2 `full_name` no vacios; la consulta a `nombre`/`apellido` falla con `column profiles.nombre does not exist`. En esa base no hay datos reales que preservar en esas columnas porque no existen. En el repo, `0002_fase1_perfil.sql` si las agrega, por lo que una migracion de retiro debe usar `DROP COLUMN IF EXISTS`.

## 2. Mapa de impacto

### A. Esquema

| Archivo:linea | Punto | Impacto |
|---|---|---|
| `supabase/migrations/0001_init.sql:26` | `CREATE TABLE public.profiles` | Define el esquema base de `profiles`. |
| `supabase/migrations/0001_init.sql:29` | `full_name TEXT` | Crea `full_name`; nullable, sin default. |
| `supabase/migrations/0001_init.sql:177` | `INSERT INTO public.profiles (id, email, full_name)` | El trigger de alta escribe `full_name`. |
| `supabase/migrations/0001_init.sql:181` | `COALESCE(... 'full_name', '')` | Si no hay metadata, escribe string vacio en `full_name`. |
| `supabase/migrations/0002_fase1_perfil.sql:14` | `ALTER TABLE public.profiles` | Agrega campos de Fase 1. |
| `supabase/migrations/0002_fase1_perfil.sql:15` | `ADD COLUMN IF NOT EXISTS nombre TEXT` | Crea `nombre`; nullable, sin default. |
| `supabase/migrations/0002_fase1_perfil.sql:16` | `ADD COLUMN IF NOT EXISTS apellido TEXT` | Crea `apellido`; nullable, sin default. |
| Supabase remoto configurado | Consulta read-only | `nombre`/`apellido` no existen; `profiles` tiene 2 filas, 2 con `full_name` no vacio. |

### B. Escritura del nombre

| Archivo:linea | Punto | Impacto |
|---|---|---|
| `app/(app)/gestion-usuarios/actions.ts:9` | `CreateUserInput.full_name` | La creacion modela nombre como campo unico. |
| `app/(app)/gestion-usuarios/actions.ts:25` | `user_metadata: { full_name }` | Auth recibe `full_name`; alimenta el trigger. |
| `app/(app)/gestion-usuarios/actions.ts:30` | `profiles.update` | Actualiza perfil luego de crear auth user. |
| `app/(app)/gestion-usuarios/actions.ts:33` | `full_name: input.full_name` | Creacion escribe `profiles.full_name`. |
| `app/(app)/gestion-usuarios/actions.ts:44` | `UpdateUserInput.full_name` | Edicion en Gestion de Usuarios usa campo unico. |
| `app/(app)/gestion-usuarios/actions.ts:56` | `profiles.update` | Edicion de usuario actualiza perfil. |
| `app/(app)/gestion-usuarios/actions.ts:59` | `full_name: input.full_name` | Edicion escribe `profiles.full_name`. |
| `app/(app)/mi-perfil/actions.ts:14` | `UpdateProfileInput` | Edicion de perfil todavia recibe `nombre`/`apellido`. |
| `app/(app)/mi-perfil/actions.ts:32` | `const update: ProfileUpdate` | Payload de edicion de perfil. |
| `app/(app)/mi-perfil/actions.ts:33` | `nombre: input.nombre || null` | Edicion de perfil escribe `nombre`. |
| `app/(app)/mi-perfil/actions.ts:34` | `apellido: input.apellido || null` | Edicion de perfil escribe `apellido`. |
| `app/(app)/mi-perfil/ProfileEditForm.tsx:34` | `useState(profile.nombre)` | Formulario carga `nombre`. |
| `app/(app)/mi-perfil/ProfileEditForm.tsx:35` | `useState(profile.apellido)` | Formulario carga `apellido`. |
| `app/(app)/mi-perfil/ProfileEditForm.tsx:53` | `updateProfile({...})` | Envia cambios de perfil. |
| `app/(app)/mi-perfil/ProfileEditForm.tsx:55` | `nombre, apellido` | Envia campos separados, no `full_name`. |
| `supabase/seed.ts:46` | `user_metadata.full_name` | Seed de admin escribe metadata `full_name`. |
| `supabase/seed.ts:53` | `update({ role, full_name })` | Seed actualiza `profiles.full_name`. |
| `tests/integration/helpers.ts:176` | `INSERT ... full_name` | Seed de integracion usa `full_name`. |
| `tests/integration/helpers.ts:185` | `full_name = EXCLUDED.full_name` | Upsert de integracion mantiene `full_name`. |
| `tests/integration/mi-perfil.test.ts:39` | `UPDATE profiles SET nombre...` | Seed especifico de Mi Perfil escribe `nombre`/`apellido`. |
| `tests/integration/mi-perfil.test.ts:46` | `UPDATE profiles SET nombre...` | Seed especifico para supervisor escribe `nombre`/`apellido`. |

### C. Lectura y visualizacion del nombre

| Archivo:linea | Punto | Impacto |
|---|---|---|
| `app/(app)/mi-perfil/ProfileView.tsx:39` | `profile.nombre` | Mi Perfil muestra `nombre`; usuarios con solo `full_name` ven "Sin datos". |
| `app/(app)/mi-perfil/ProfileView.tsx:40` | `profile.apellido` | Mi Perfil muestra `apellido`; mismo problema. |
| `app/(app)/mi-perfil/page.tsx:13` | `requireAuth()` | Perfil viene de auth helper; se pasa a ProfileView/ProfileEditForm. |
| `app/(app)/mi-perfil/page.tsx:63` | `<ProfileEditForm profile={profile} />` | Admin edita su perfil con campos separados. |
| `app/(app)/mi-perfil/page.tsx:70` | `<ProfileView profile={safeProfile} />` | Render de perfil depende de ProfileView. |
| `app/(app)/admin/empleado/[id]/page.tsx:23` | `profiles.select('*')` | Carga perfil de empleado para admin. |
| `app/(app)/admin/empleado/[id]/page.tsx:52` | `displayName` | Arma nombre visible. |
| `app/(app)/admin/empleado/[id]/page.tsx:53` | `employeeProfile.nombre && employeeProfile.apellido` | Requiere ambos campos separados. |
| `app/(app)/admin/empleado/[id]/page.tsx:54` | Template `nombre apellido` | DisplayName no usa `full_name`. |
| `app/(app)/admin/empleado/[id]/page.tsx:74` | `<ProfileEditForm>` | Admin edita empleado con campos separados. |
| `app/(app)/admin/empleado/[id]/page.tsx:78` | `<ProfileView>` | Admin ve empleado con campos separados. |
| `app/(app)/mi-perfil/actions.ts:151` | `EmployeeSearchResult` | Tipo de resultado expone `nombre`/`apellido`. |
| `app/(app)/mi-perfil/actions.ts:166` | `select('id, nombre, apellido, email, role')` | Busqueda selecciona campos separados. |
| `app/(app)/mi-perfil/actions.ts:168` | `.or(nombre/apellido/email)` | Busqueda matchea `nombre` y `apellido`, no `full_name`. |
| `app/(app)/mi-perfil/AdminEmployeeSelector.tsx:90` | `emp.nombre && emp.apellido` | Dropdown arma displayName desde campos separados. |
| `app/(app)/mi-perfil/AdminEmployeeSelector.tsx:91` | Template `nombre apellido` | Fallback a email si falta cualquiera. |
| `app/(app)/aprobaciones/page.tsx:9` | `Pick<Profile, 'nombre' | 'apellido' | 'email'>` | Tipo del join usa campos separados. |
| `app/(app)/aprobaciones/page.tsx:19` | Join `nombre, apellido, email` | Aprobaciones consulta campos separados. |
| `app/(app)/aprobaciones/AprobacionesTable.tsx:13` | `Pick<Profile, 'nombre' | 'apellido' | 'email'>` | Tabla tipa campos separados. |
| `app/(app)/aprobaciones/AprobacionesTable.tsx:31` | `userName` | Helper de displayName. |
| `app/(app)/aprobaciones/AprobacionesTable.tsx:34` | `p.nombre && p.apellido` | Requiere campos separados; fallback email. |
| `app/(app)/gestion-usuarios/page.tsx:18` | `.order('full_name')` | Gestion de Usuarios ya ordena por `full_name`. |
| `app/(app)/gestion-usuarios/UserFormModal.tsx:44` | `editingUser?.full_name` | Formulario de usuarios lee `full_name`. |
| `app/(app)/gestion-usuarios/UserFormModal.tsx:98` | `supervisors.map` | Opciones de supervisor. |
| `app/(app)/gestion-usuarios/UserFormModal.tsx:100` | `s.full_name || s.email` | Display supervisor ya usa `full_name`. |
| `app/(app)/gestion-usuarios/UserTable.tsx:28` | `sup?.full_name` | Display supervisor ya usa `full_name`. |
| `app/(app)/gestion-usuarios/UserTable.tsx:44` | `u.full_name || '—'` | Tabla de usuarios ya usa `full_name`. |
| `app/(app)/layout.tsx:7` | `profile.full_name || profile.email` | Shell ya usa `full_name`. |
| `app/(app)/dashboard/page.tsx:17` | `profile.full_name || profile.email` | Dashboard ya usa `full_name`. |

### D. Error tragado

| Archivo:linea | Punto | Impacto |
|---|---|---|
| `app/(app)/mi-perfil/actions.ts:164` | `const { data } = await admin` | `searchEmployees` descarta `error`. |
| `app/(app)/mi-perfil/actions.ts:171` | `return (data ?? [])` | Cualquier error se ve como "sin resultados". |
| `app/(app)/mi-perfil/actions.ts:129` | `const { data: rawVisibles } = await supabase` | `getSignedUrls` descarta error al consultar documentos visibles. |
| `app/(app)/mi-perfil/actions.ts:135` | `rawVisibles ?? []` | Error de autorizacion/query produce set vacio de autorizados. |
| `app/(app)/admin/empleado/[id]/page.tsx:23` | `const { data: rawProfile }` | Carga perfil sin chequear error; no es busqueda, pero un fallo cae como `notFound`. |
| `app/(app)/admin/empleado/[id]/page.tsx:33` | `const { data: docsRaw }` | Carga documentos sin chequear error; fallo cae como lista vacia. |

### E. Tipos y copy

| Archivo:linea | Punto | Impacto |
|---|---|---|
| `supabase/types.ts:329` | `Row.apellido` | Tipos generados incluyen `apellido`. |
| `supabase/types.ts:336` | `Row.full_name` | Tipos generados incluyen `full_name`. |
| `supabase/types.ts:338` | `Row.nombre` | Tipos generados incluyen `nombre`. |
| `supabase/types.ts:347` | `Insert.apellido` | Insert permite `apellido`. |
| `supabase/types.ts:354` | `Insert.full_name` | Insert permite `full_name`. |
| `supabase/types.ts:356` | `Insert.nombre` | Insert permite `nombre`. |
| `supabase/types.ts:365` | `Update.apellido` | Update permite `apellido`. |
| `supabase/types.ts:372` | `Update.full_name` | Update permite `full_name`. |
| `supabase/types.ts:374` | `Update.nombre` | Update permite `nombre`. |
| `lib/db-types.ts:16` | `Profile = Tables<'profiles'>` | Todos los componentes heredan `nombre`/`apellido` desde tipos generados. |
| `lib/db-types.ts:26` | `ProfileInsert` | Alias arrastra campos separados. |
| `lib/db-types.ts:27` | `ProfileUpdate` | Alias arrastra campos separados. |
| `lib/copy/index.ts:101` | `gestionUsuarios.table.nombre` | Label generico "Nombre"; compatible con `full_name`. |
| `lib/copy/index.ts:110` | `gestionUsuarios.form.nombre` | Ya dice "Nombre completo". |
| `lib/copy/index.ts:140` | `miPerfil.fields.nombre` | Label separado "Nombre"; debe pasar a nombre completo. |
| `lib/copy/index.ts:141` | `miPerfil.fields.apellido` | Label a retirar. |
| `lib/copy/index.ts:164` | `miPerfil.placeholders.nombre` | Placeholder separado. |
| `lib/copy/index.ts:165` | `miPerfil.placeholders.apellido` | Placeholder a retirar. |
| `lib/copy/index.ts:255` | `selectorPlaceholder` | Dice "Buscar por nombre, apellido o correo"; debe decir nombre completo/correo. |

### F. Tests y seed de test

| Archivo:linea | Punto | Impacto |
|---|---|---|
| `tests/integration/helpers.ts:176` | `INSERT ... full_name` | Seed base de integracion ya usa `full_name`. |
| `tests/integration/helpers.ts:185` | `full_name = EXCLUDED.full_name` | Upsert base ya mantiene `full_name`. |
| `tests/integration/mi-perfil.test.ts:39` | `SET nombre = 'Juan', apellido = 'Pérez'` | Seed especifico depende de columnas separadas. |
| `tests/integration/mi-perfil.test.ts:105` | Describe "nombre, apellido..." | Suite modela campos separados. |
| `tests/integration/mi-perfil.test.ts:109` | `SELECT nombre, apellido...` | Assert de lectura depende de columnas separadas. |
| `tests/integration/mi-perfil.test.ts:113` | `expect(nombre).toBe('Juan')` | Assert directo de `nombre`. |
| `tests/integration/mi-perfil.test.ts:114` | `expect(apellido).toBe('Pérez')` | Assert directo de `apellido`. |
| `tests/integration/mi-perfil.test.ts:124` | `UPDATE profiles SET nombre, apellido` | Assert de denegacion usa campos separados. |
| `tests/integration/mi-perfil.test.ts:143` | `SELECT nombre, apellido...` | Supervisor lee campos separados. |
| `tests/integration/mi-perfil.test.ts:154` | `SELECT nombre` | Caso negativo usa `nombre`. |
| `tests/integration/mi-perfil.test.ts:164` | `UPDATE profiles SET nombre, apellido...` | Admin update usa campos separados. |
| `tests/integration/mi-perfil.test.ts:427` | `UPDATE profiles SET nombre` | Caso supervisor update usa campo separado. |
| `tests/integration/mi-perfil.test.ts:441` | `UPDATE profiles SET nombre` | Caso admin update usa campo separado. |
| `tests/integration/migration.test.ts:121` | Test de columnas nuevas | Espera que `nombre`/`apellido` existan. |
| `tests/integration/migration.test.ts:125` | `column_name IN ('nombre', 'apellido'...)` | Debe ajustarse para Opcion 1. |
| `tests/integration/migration.test.ts:129` | `expect(['apellido', ...])` | Debe dejar de esperar columnas retiradas. |
| `tests/unit/mi-perfil.test.ts:98` | Test copy perfil | Espera labels de campos de perfil. |
| `tests/unit/mi-perfil.test.ts:99` | `copy.miPerfil.fields.nombre` | Debe apuntar a label de nombre completo o cambiar key. |
| `tests/unit/mi-perfil.test.ts:100` | `copy.miPerfil.fields.apellido` | Debe retirarse/actualizarse. |
| `tests/integration/rls.test.ts:122` | `UPDATE profiles SET full_name` | RLS ya cubre `full_name`. |
| `tests/integration/rls.test.ts:201` | `UPDATE profiles SET full_name` | Denegacion empleado ya usa `full_name`. |
| `tests/integration/rls.test.ts:209` | `UPDATE profiles SET full_name` | Denegacion supervisor ya usa `full_name`. |
| `tests/integration/rls.test.ts:217` | `UPDATE profiles SET full_name` | Admin update ya usa `full_name`. |

## 3. Plan de fix Opcion 1

1. Migracion de esquema:
   - Agregar una migracion nueva que retire el modelo separado con `ALTER TABLE public.profiles DROP COLUMN IF EXISTS nombre, DROP COLUMN IF EXISTS apellido;`.
   - Mantener `full_name` como unico campo de nombre. Evaluar si conviene agregar constraint posterior sobre `full_name` no vacio; hoy es nullable y el trigger puede guardar `''`.
   - No tocar RLS de `storage.objects`.

2. Escritura:
   - Cambiar `UpdateProfileInput` para aceptar `full_name` en lugar de `nombre`/`apellido`.
   - Cambiar `updateProfile` para escribir `full_name: input.full_name || null`.
   - Cambiar `ProfileEditForm` para usar un unico estado/input `fullName` inicializado desde `profile.full_name`.
   - Mantener `createUser`, `updateUser`, `supabase/seed.ts` y `tests/integration/helpers.ts` como base, porque ya escriben `full_name`.

3. Lectura y display:
   - Cambiar `ProfileView` para mostrar un unico campo "Nombre completo" desde `profile.full_name`.
   - Cambiar `admin/empleado/[id]/page.tsx` para que `displayName = employeeProfile.full_name || employeeProfile.email`.
   - Cambiar `AdminEmployeeSelector` para mostrar `emp.full_name || emp.email`.
   - Cambiar Aprobaciones: el join debe seleccionar `full_name, email`, el tipo debe ser `Pick<Profile, 'full_name' | 'email'>`, y `userName` debe usar `full_name || email`.
   - Gestion de Usuarios, layout y dashboard ya estan alineados con `full_name`; solo revisar copy si se cambia key.

4. Busqueda:
   - Cambiar `EmployeeSearchResult` a `{ id, full_name, email, role }`.
   - Cambiar select a `id, full_name, email, role`.
   - Cambiar filtro a `full_name.ilike.%q%,email.ilike.%q%`.
   - Dejar de tragar errores: destructurar `{ data, error }`, y si `error` existe, loguear con contexto suficiente y lanzar `new Error(copy.errors.generic)` o un mensaje especifico.
   - Revisar escaping/sanitizacion del string `.or(...)`; si el query contiene caracteres especiales para PostgREST, puede romper el filtro.

5. Tipos, copy y tests:
   - Regenerar `supabase/types.ts` contra el esquema final y verificar que `profiles.Row/Insert/Update` ya no incluyan `nombre`/`apellido`.
   - `lib/db-types.ts` no necesita nuevos aliases, pero heredara el cambio de `Tables<'profiles'>`.
   - Actualizar `lib/copy/index.ts`: Mi Perfil debe tener label/placeholder de `full_name` o reutilizar `nombre` como "Nombre completo"; retirar `apellido`; actualizar placeholder del selector.
   - Actualizar tests de Mi Perfil para sembrar/asertar `full_name`.
   - Actualizar `migration.test.ts` para esperar ausencia de `nombre`/`apellido` y presencia de `full_name`, `cuit`, `winda_id`.
   - Mantener tests RLS que ya usan `full_name` y adaptar los de Mi Perfil que todavia usan columnas separadas.

6. Errores silenciosos adyacentes:
   - En el mismo fix o en un prompt separado, revisar `getSignedUrls`, `admin/empleado/[id]/page.tsx` perfil/docs y cualquier accion cercana que haga `const { data }` sin `error`, porque hoy algunos fallos se transforman en lista vacia o 404.

## 4. Riesgos de regresion

- Desfase de esquema: el repo incluye `0002_fase1_perfil.sql` con `nombre`/`apellido`, pero el Supabase remoto configurado no las tiene. La migracion debe ser idempotente (`IF EXISTS`) y los tipos deben regenerarse desde el esquema real final.
- Datos existentes: en el Supabase consultado no hay columnas separadas que preservar. Si otro ambiente si aplico `0002` y tiene datos reales en `nombre`/`apellido`, antes del DROP habria que migrar `full_name = trim(nombre || ' ' || apellido)` solo para filas con `full_name` vacio.
- `full_name` es nullable y puede quedar `''` por trigger; si la UI depende de nombre completo, conservar fallback a email.
- Tests de integracion de Mi Perfil y migracion fallaran hasta reemplazar asserts de `nombre`/`apellido`.
- Aprobaciones y selector de empleados comparten helpers de displayName implicitos; si se corrige solo Mi Perfil, quedaran inconsistencias visibles.
- La busqueda con `.or(...)` interpolando `q` puede seguir fallando para caracteres especiales aunque se cambie a `full_name`; conviene cubrirlo con test.
- Si `searchEmployees` empieza a lanzar errores, el componente cliente necesita mostrar estado de error y no dejar una promise rechazada sin feedback.
