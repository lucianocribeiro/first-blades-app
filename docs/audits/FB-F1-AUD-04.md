# FB-F1-AUD-04 - Auditoria final de Fase 1

## Resumen ejecutivo

Fase 1 no esta apta para cierre en su estado actual. La implementacion cubre gran parte del flujo de Mi Perfil, Aprobaciones, Storage privado, cron protegido y tests contra Supabase local real, pero quedan brechas de autorizacion sobre signed URLs y sobre la coherencia `documents.storage_path`/`user_id`. Tambien hay una falla de retencion: la purga puede marcar un archivo como eliminado aunque Storage haya devuelto error. Los hallazgos altos deben ordenarse antes de declarar cerrada la fase.

## Hallazgos

### Alto - Server action genera signed URLs sin autenticar ni autorizar cada path

- **Ubicacion:** `app/(app)/mi-perfil/actions.ts:116`
- **Descripcion:** `getSignedUrls(paths)` es una server action exportada desde un modulo `'use server'`, acepta paths arbitrarios, no llama a `requireAuth()`/`requireAdmin()` y delega en `createSignedUrl`, que usa el admin client con service role (`lib/storage.ts:39`, `lib/supabase/admin.ts:5`). No verifica que cada path pertenezca al usuario autenticado, al perfil que un admin esta viendo, ni que el documento exista y sea visible por RLS.
- **Impacto:** si la accion queda invocable desde cliente, un usuario autenticado podria pedir una signed URL para cualquier objeto del bucket `documents` cuyo path conozca o adivine. Esto bypassa las policies de `storage.objects` porque la URL se crea con service role.
- **Recomendacion:** cerrar la funcion con autenticacion y autorizacion por documento/path antes de generar cada URL. Para no-admin, validar pertenencia contra filas `documents` visibles al usuario y carpeta propia; para admin, validar existencia y scope esperado. Evitar exponer un helper server action generico que firme paths arbitrarios.

### Alto - `documents_insert_own` no exige que `storage_path` pertenezca al `user_id`

- **Ubicacion:** `supabase/migrations/0001_init.sql:280`
- **Descripcion:** la policy de INSERT para empleados solo chequea `user_id = auth.uid()`, `uploaded_by = auth.uid()` y `estado = 'pendiente'`; no valida que `storage_path` empiece con la carpeta del usuario. El flujo de app genera paths correctos (`lib/storage.ts:65`), pero la RLS permite que un cliente autenticado inserte una fila propia apuntando a un path ajeno.
- **Impacto:** combinado con la generacion server-side de signed URLs para las filas propias (`app/(app)/mi-perfil/page.tsx:33`), una fila maliciosa podria convertir un path ajeno conocido en una URL firmada servida por la app. Aunque Storage bloquee la subida a carpetas ajenas, la fila de metadatos queda como vector de lectura.
- **Recomendacion:** reforzar la policy/constraint para exigir coherencia entre `storage_path` y `user_id` tambien en DB, no solo en la capa de app. Aplicar el mismo criterio a updates/insert admin segun el contrato del modulo.

### Alto - Documentos `estudio_medico` no son realmente admin-only en DB/Storage

- **Ubicacion:** `tests/integration/mi-perfil.test.ts:361`
- **Descripcion:** el test documenta que un empleado puede leer su propia fila `estudio_medico` por RLS y que la ocultacion ocurre solo en app layer. Ademas, el admin upload guarda el archivo en la carpeta del empleado (`app/(app)/mi-perfil/actions.ts:187`) y la policy de Storage permite al usuario leer/listar su propia carpeta (`supabase/migrations/0004_rls_fixes.sql:22`).
- **Impacto:** si `estudio_medico` es dato/archivo solo-admin, un empleado podria descubrir la fila via API directa de Supabase y potencialmente acceder al objeto por Storage API por estar en su carpeta. La restriccion de presentacion en `Mi Perfil` (`app/(app)/mi-perfil/page.tsx:28`) no es un control de seguridad.
- **Recomendacion:** definir y hacer cumplir el contrato de visibilidad de `estudio_medico` en RLS/Storage o almacenarlo bajo una ubicacion que no quede cubierta por lectura propia del empleado. Mantener la UI como defensa adicional, no como control primario.

### Alto - La purga marca archivos como purgados aunque `remove()` falle

- **Ubicacion:** `lib/purge.ts:66`
- **Descripcion:** `purgeRejectedDocuments()` llama `admin.storage.from(...).remove([doc.storage_path])` pero no inspecciona el `{ error }` que devuelve supabase-js. Luego actualiza `file_purged_at` (`lib/purge.ts:68`) y cuenta la purga como exitosa.
- **Impacto:** ante un error de Storage, la fila queda marcada como purgada, la UI deja de generar signed URL, pero el archivo fisico puede seguir existiendo en el bucket. Esto rompe la garantia de retencion y dificulta reintentos porque la condicion `file_purged_at IS NULL` ya no selecciona la fila.
- **Recomendacion:** tratar errores de Storage como fallo de purga, no setear `file_purged_at` si el delete no fue exitoso y dejar la fila elegible para reintento.

### Alto - Existe un path de carga admin que auto-aprueba documentos

- **Ubicacion:** `app/(app)/mi-perfil/actions.ts:161`
- **Descripcion:** `uploadDocumentForEmployee()` inserta documentos con `estado: 'aprobado'`, `reviewed_by` y `reviewed_at` en el mismo paso (`app/(app)/mi-perfil/actions.ts:198`). Esto no pasa por la bandeja de Aprobaciones.
- **Impacto:** contradice el invariante solicitado para la auditoria: toda submission nativa debe entrar como `pendiente` y no debe existir path que auto-apruebe. Aunque el actor sea admin, el modulo pierde trazabilidad operacional y homogeneidad del purgatorio.
- **Recomendacion:** alinear el flujo admin con el contrato decidido: si toda carga debe pasar por purgatorio, insertar como `pendiente`; si la carga admin directa aprobada es una excepcion valida, documentarla explicitamente en DoD/PRD y cubrirla con auditoria/test como excepcion deliberada.

### Medio - Las aprobaciones/rechazos no escriben `audit_log`

- **Ubicacion:** `app/(app)/aprobaciones/actions.ts:10`
- **Descripcion:** las acciones `approveDocument()` y `rejectDocument()` actualizan `documents`, pero no llaman a `log_audit` ni existe trigger en migraciones que registre transiciones de estado. La funcion `log_audit` existe y esta restringida a `service_role` (`supabase/migrations/0001_init.sql:196`), pero no se usa en estas transiciones.
- **Impacto:** la tabla `audit_log` queda protegida correctamente, pero no cumple su rol de registro inmutable para aprobaciones/rechazos. Se pierde trazabilidad de decisiones administrativas.
- **Recomendacion:** registrar cada transicion de estado de documentos desde el servicio autorizado o mediante trigger acotado, conservando actor, datos anteriores y nuevos.

### Medio - El rechazo con motivo obligatorio se valida en app, no en DB

- **Ubicacion:** `app/(app)/aprobaciones/actions.ts:32`
- **Descripcion:** `rejectDocument()` exige `motivo.trim()` antes del update, pero la tabla/policy permite que un admin actualice `estado = 'rechazado'` con `motivo_rechazo` nulo o vacio por SQL/API directa (`supabase/migrations/0001_init.sql:291`).
- **Impacto:** el flujo UI cumple, pero el invariante de datos puede romperse fuera de esa server action, dejando rechazos sin motivo obligatorio.
- **Recomendacion:** mover el invariante a DB con constraint/trigger o una funcion de transicion unica, y dejar la validacion UI como feedback temprano.

### Medio - La suite de purga no ejercita la eliminacion real de Storage ni la funcion productiva

- **Ubicacion:** `tests/integration/purge.test.ts:4`
- **Descripcion:** el test de integracion declara que no prueba eliminacion real de Storage, y valida queries SQL/updates manuales en lugar de ejecutar `purgeRejectedDocuments()` contra el bucket real. La suite si ejercita Storage API real para RLS (`tests/integration/rls.test.ts:688`), pero no para la purga de retencion.
- **Impacto:** el bug de no inspeccionar `remove().error` en `lib/purge.ts` puede pasar inadvertido. La cobertura no confirma que el job borre archivo fisico y actualice fila en un flujo real.
- **Recomendacion:** agregar cobertura de integracion que siembre un objeto real, ejecute la funcion productiva con service role y verifique tanto ausencia del objeto como update de `file_purged_at`, incluyendo caso de error/reintento.

### Informativo - No hay `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` explicito en migraciones

- **Ubicacion:** `supabase/migrations/0004_rls_fixes.sql:20`
- **Descripcion:** las migraciones crean/droppean policies sobre `storage.objects`, pero no intentan habilitar RLS sobre esa tabla. Esto es correcto para Supabase real y coincide con la decision del proyecto.
- **Impacto:** evita fallos por ownership de la tabla interna de Supabase.
- **Recomendacion:** mantener el DoD actualizado para no pedir ese `ALTER TABLE`; validar Storage por API real, como hace `tests/integration/rls.test.ts`.

## Verificacion del DoD

| Item | Estado | Evidencia / ajuste |
| --- | --- | --- |
| Mi Perfil muestra datos propios para empleado/supervisor y admin con acceso extendido | Cumplido con reservas | `requireAuth()` carga perfil propio (`lib/auth.ts:8`) y la UI oculta campos admin a no-admin (`app/(app)/mi-perfil/ProfileView.tsx:60`). Reserva: `requireAuth()` hace `select('*')`, por lo que campos solo-admin viajan al componente aunque no se rendericen. |
| Empleado/supervisor no editan perfiles; admin edita | Cumplido | RLS solo permite UPDATE admin (`supabase/migrations/0001_init.sql:252`) y la server action exige `requireAdmin()` (`app/(app)/mi-perfil/actions.ts:27`). |
| Supervisor ve su fila + equipo en `profiles` por RLS | Cumplido | Policy `profiles_select` incluye `supervisor_id = auth.uid()` (`supabase/migrations/0001_init.sql:237`) y tests lo ejercitan (`tests/integration/rls.test.ts:168`). |
| Documentos propios entran en `pendiente` y van a Aprobaciones | Cumplido con reservas | Upload propio fuerza `estado: 'pendiente'` (`app/(app)/mi-perfil/actions.ts:89`) y Aprobaciones lista pendientes (`app/(app)/aprobaciones/page.tsx:17`). Reserva: carga admin auto-aprueba (`app/(app)/mi-perfil/actions.ts:198`). |
| No existe path de auto-aprobacion | No cumplido | `uploadDocumentForEmployee()` inserta `estado: 'aprobado'` directamente (`app/(app)/mi-perfil/actions.ts:198`). |
| Rechazo exige motivo obligatorio | Cumplido con reservas | UI/server action validan motivo (`app/(app)/aprobaciones/actions.ts:32`), pero no hay constraint DB que impida rechazos sin motivo por otros paths admin. |
| Bucket `documents` privado | Cumplido | Migracion crea bucket con `public = false` (`supabase/migrations/0001_init.sql:440`). |
| Signed URLs con expiracion razonable, server-side, sin public URLs | No cumplido | La expiracion es razonable: 1 hora (`lib/storage.ts:9`) y se usa `createSignedUrl` (`lib/storage.ts:39`). Pero la server action firma paths arbitrarios sin authz (`app/(app)/mi-perfil/actions.ts:116`). |
| `storage_path` estructurado por `user_id` y protegido por policies | No cumplido | La app genera `{userId}/...` (`lib/storage.ts:65`), pero la RLS de `documents` no valida `storage_path` contra `user_id` (`supabase/migrations/0001_init.sql:280`). |
| Policies de Storage cubren carpeta propia + admin sin huecos | Cumplido con reservas | INSERT/SELECT por carpeta propia o admin y DELETE admin (`supabase/migrations/0004_rls_fixes.sql:22`, `supabase/migrations/0004_rls_fixes.sql:37`, `supabase/migrations/0001_init.sql:479`). Reserva: si `estudio_medico` debe ser admin-only, ubicarlo en carpeta del empleado rompe esa privacidad. |
| Dropear item "habilitar RLS sobre `storage.objects`" | A actualizar | No debe estar en el DoD. Supabase es dueña de la tabla; el proyecto ya retiro ese `ALTER TABLE`. |
| Storage se valida via Storage API real en CI, no SQL crudo sobre `storage.objects` | Cumplido | Tests usan Supabase local y Storage API real (`tests/integration/rls.test.ts:688`); CI exporta credenciales del Supabase local (`.github/workflows/ci.yml:77`). |
| Retencion/purga a 30 dias | No cumplido | La seleccion por fecha existe (`lib/purge.ts:51`) y el cron esta protegido (`app/api/cron/purge-rejected-docs/route.ts:11`), pero la funcion no valida errores de `remove()` antes de marcar purgado (`lib/purge.ts:66`). Ademas, el alcance de esta auditoria pide purgar archivo + fila; la implementacion conserva la fila por decision documentada de FB-F1-02. |
| Endpoint/cron protegido | Cumplido | Exige `Authorization: Bearer <CRON_SECRET>` y falla cerrado si falta secret (`app/api/cron/purge-rejected-docs/route.ts:8`). |
| `audit_log`: solo admin lee; roles no insertan directo | Cumplido con reservas | RLS permite SELECT admin y no hay INSERT policy (`supabase/migrations/0001_init.sql:430`). Reserva: aprobaciones/rechazos no escriben audit log. |
| `service_role` solo server-side; no `NEXT_PUBLIC_*` para service key | Cumplido | `createAdminClient()` usa `SUPABASE_SERVICE_ROLE_KEY` sin prefijo publico (`lib/supabase/admin.ts:5`); clientes browser usan anon key (`lib/supabase/client.ts:6`). |
| Secrets/env completos y `.env.local` no commiteado | Cumplido | `.env.example` incluye Supabase, service role server-only, tests y `CRON_SECRET` (`.env.example:1`); `.env.local` esta gitignored (`.gitignore:25`) y no aparece en `git ls-files`. |
| Tests de Fase 1 adecuados y sin mocks ocultos criticos | Cumplido con reservas | Integracion corre contra Supabase local real (`.github/workflows/ci.yml:74`) y Storage API real para RLS. Reserva: purga no ejercita Storage real ni la funcion productiva (`tests/integration/purge.test.ts:4`). |

## Recomendacion de cierre

**No cerrar Fase 1 todavia.** Bloquean el cierre: signed URLs sin autorizacion, falta de coherencia DB entre `storage_path` y `user_id`, visibilidad real de `estudio_medico` si se confirma como admin-only, purga que marca exito aunque Storage falle, y path admin de auto-aprobacion si el contrato "todo pendiente" no admite excepciones.

Pueden diferirse sin bloquear si Producto/Tech Lead los acepta explicitamente: audit log de transiciones y hardening DB del motivo obligatorio, aunque ambos deberian ordenarse como `FB-F1-NN` por trazabilidad. La actualizacion del DoD sobre `storage.objects` es informativa: debe quedar dropeado el item de habilitar RLS sobre esa tabla y reemplazado por validacion via Storage API real.
