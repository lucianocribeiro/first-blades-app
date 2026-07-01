# FB-F1-AUD-07 — Spot-check del fix de nombre y drift de migraciones

## 1. Veredicto

Fix de nombre y sincronizacion de migraciones: cerrados con reservas menores. La app ya escribe, lee, muestra y busca por `full_name`, `supabase migration list` confirma `0001`-`0007` en Local y Remote, y los errores principales ya no se tragan.

Reservas: quedan referencias literales/genericas a `nombre` en copy/UI/tests que no apuntan a `profiles.nombre`, y `admin/empleado/[id]` todavia convierte un error de carga de documentos en lista vacia despues de loguearlo.

## 2. Tabla A-F

| Area | Estado | Evidencia |
|---|---|---|
| A. Unificacion en `full_name` | Parcial | Migracion `0007` retira columnas con `DROP COLUMN IF EXISTS nombre/apellido` (`supabase/migrations/0007_profiles_unify_full_name.sql:4`, `:5`). Escritura de Mi Perfil usa `UpdateProfileInput.full_name` y update a `full_name` (`app/(app)/mi-perfil/actions.ts:14`, `:32`). `ProfileEditForm` inicializa/envia `profile.full_name` (`app/(app)/mi-perfil/ProfileEditForm.tsx:34`, `:54`). `ProfileView`, selector, admin-empleado y Aprobaciones usan `full_name` (`ProfileView.tsx:39`, `AdminEmployeeSelector.tsx:102`, `admin/empleado/[id]/page.tsx:60`, `aprobaciones/page.tsx:9`, `:19`, `AprobacionesTable.tsx:34`). Busqueda selecciona y matchea `full_name,email` (`app/(app)/mi-perfil/actions.ts:175`-`:179`). Reserva: `rg` aun encuentra referencias no-modelo a `nombre`: copy de Gestion Usuarios (`lib/copy/index.ts:101`, `:110`), placeholder de Mi Perfil `nombreCompleto` (`lib/copy/index.ts:163`), selector (`lib/copy/index.ts:253`), key de tabla (`UserTable.tsx:40`) y comentarios/tests que mencionan retiro (`tests/integration/migration.test.ts:121`-`:133`). |
| B. Errores tragados | Parcial | `searchEmployees` ahora destructura `{ data, error }`, loguea y lanza error (`app/(app)/mi-perfil/actions.ts:175`, `:182`-`:184`); el cliente maneja catch y muestra error (`AdminEmployeeSelector.tsx:39`-`:47`, `:85`-`:87`). `getSignedUrls` chequea `visiblesError` y lanza (`actions.ts:127`, `:132`-`:134`). `rg` en rutas tocadas muestra que los `const { data... }` relevantes incluyen `error` (`mi-perfil/page.tsx:20`, `actions.ts:127`, `actions.ts:175`, `aprobaciones/page.tsx:17`, `admin/empleado/[id]/page.tsx:23`, `:37`). Reserva: en admin-empleado, error de perfil se loguea y cae en `notFound()` (`admin/empleado/[id]/page.tsx:29`-`:33`), y error de documentos se loguea pero luego `docsRaw ?? []` renderiza vacio (`:43`-`:47`). |
| C. Sanitizacion de busqueda | Cerrado con reserva de test | `searchEmployees` sanitiza `q.trim()` con `escapePostgrestFilter` antes de interpolar en `.or(...)` (`app/(app)/mi-perfil/actions.ts:162`-`:179`). Hay test unitario para caracteres especiales de PostgREST (`tests/unit/mi-perfil.test.ts:183`-`:225`). Reserva menor: el test duplica la funcion privada en vez de ejercitar `searchEmployees` directamente. |
| D. Tipos y consistencia | Cerrado | `supabase/types.ts` para `profiles.Row/Insert/Update` contiene `full_name` y no contiene `nombre`/`apellido` (`supabase/types.ts:327`-`:375`). |
| E. Drift de migraciones | Cerrado | Repo tiene migraciones ordenadas `0001_init.sql` a `0007_profiles_unify_full_name.sql` sin gaps. `supabase migration list` ejecutado en modo lectura confirma Local/Remote `0001`-`0007`. Nota de proceso: CI no aplica migraciones remotas; produccion requiere `supabase db push` explicito en handoff/deploy. |
| F. No-regresion FB-F1-12..21 | Cerrado | Limpieza de Storage sigue via Storage API, no SQL directo (`tests/integration/helpers.ts:67`-`:101`, `:142`-`:146`). Advisory lock y liberacion en error siguen presentes (`tests/integration/helpers.ts:124`-`:129`, `:223`-`:228`). Seed tipado y base usa `full_name` (`tests/integration/helpers.ts:175`-`:188`). Constraints siguen versionadas: `storage_path` por `user_id` (`supabase/migrations/0005_documents_storage_path_constraint.sql:5`-`:7`) y motivo obligatorio al rechazar (`supabase/migrations/0006_documents_rechazo_motivo_obligatorio.sql:4`-`:9`). Purga conserva fila y agrega `file_purged_at` (`supabase/migrations/0003_documents_purge.sql:1`-`:9`). Visibilidad/Storage de `estudio_medico` mantiene fixes de RLS sin proponer habilitar RLS sobre `storage.objects` (`supabase/migrations/0004_rls_fixes.sql:10`-`:29`, `:35`-`:44`). |

## 3. Pendientes

1. `FB-F1-NN` opcional: endurecer `admin/empleado/[id]` para no renderizar documentos como lista vacia cuando falla la query. Hoy distingue mediante log, pero la UI no distingue error de ausencia de documentos (`app/(app)/admin/empleado/[id]/page.tsx:43`-`:47`). No bloquea el fix de nombre.

2. `FB-F1-NN` opcional: limpiar referencias literales/genericas a `nombre` si el criterio es grep cero. No son usos de `profiles.nombre`, pero aparecen en copy/UI/tests (`lib/copy/index.ts:101`, `:110`, `:163`, `:253`; `UserTable.tsx:40`; `tests/integration/migration.test.ts:121`-`:133`).

3. `FB-F1-NN` opcional: reemplazar el test duplicado de `escapePostgrestFilter` por cobertura directa del comportamiento exportado de busqueda, o extraer el helper para testear la misma implementacion (`tests/unit/mi-perfil.test.ts:185`-`:225`).
