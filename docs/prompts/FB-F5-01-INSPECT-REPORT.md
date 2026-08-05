# FB-F5-01-INSPECT — Informe de inspección de solo-lectura

- **Fecha:** 2026-08-05
- **Rama:** `fase-5/f5-01-inspect` (desde `origin/main` @ `0e326a4`)
- **Proyecto Supabase:** `simfemdkrkdbumefcxei` (First Blades App, `us-east-1`, Postgres 17.6.1)
- **Método:** consultas de solo-lectura vía MCP de Supabase (`execute_sql`, `list_migrations`, `list_extensions`, `get_advisors`) + lectura de archivos del repo. **Ninguna migración, `db push`, escritura en la base, ni cambio de código de feature se ejecutó.**

---

## A. Tabla `procedures` en producción

### A.1 Columnas

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

### A.2 Constraints

```sql
-- PK
PRIMARY KEY (id)                                    -- procedures_pkey

-- FKs
FOREIGN KEY (created_by) REFERENCES profiles(id)     -- procedures_created_by_fkey
FOREIGN KEY (updated_by) REFERENCES profiles(id)     -- procedures_updated_by_fkey
```

⚠️ **No hay ningún CHECK.** En particular, no existe ningún constraint que obligue "al menos `content` o `storage_path`" (PRD Fase 5, Parte 1: "Contenido = archivo y/o texto escrito; al menos una de las dos formas"). Hoy la tabla permite una fila con `content` y `storage_path` ambos `NULL`. Esto es una regla de negocio pendiente de decidir cómo aplicarse (CHECK vs. solo validación de Server Action).

### A.3 Índices

```sql
CREATE UNIQUE INDEX procedures_pkey ON public.procedures USING btree (id)
```

Solo el índice del PK. No hay índice para búsqueda (ni `pg_trgm` ni `btree` sobre `title`/`category`) — ver bloque G.3.

### A.4 RLS y políticas

`relrowsecurity = true`, `relforcerowsecurity = false`.

```sql
-- procedures_select_all (SELECT)
USING (auth.uid() IS NOT NULL)

-- procedures_write_admin (ALL: INSERT/UPDATE/DELETE)
USING ((SELECT is_admin()))
WITH CHECK ((SELECT is_admin()))
```

⚠️ **`procedures_select_all` permite lectura a cualquier usuario autenticado, sin distinguir por rol ni por un futuro estado "archivado".** Hoy no hay columna de archivado (ver A.1), así que esto no es un problema todavía, pero cuando se agregue esa columna, esta policy **no** va a ocultar los archivados a no-admin por sí sola — hace falta agregar la condición al `USING` o filtrar en la query de la Server Action/lectura. Dejo esto anotado para el prompt de build, no lo resuelvo acá.

### A.5 Triggers

**Ninguno.** `pg_trigger` no devuelve filas para `public.procedures`. No hay `set_updated_at` ni ningún trigger.

Confirmé además que **ninguna tabla de la app** (`profiles`, `documents`, `pasaje_requests`, `ausencia_requests`, `rotation_assignments`) tiene triggers propios — la convención real del repo es que `updated_at` se setea **a mano en la Server Action** (ej. `app/(app)/gestion-usuarios/actions.ts:63` y `:78`: `updated_at: new Date().toISOString()`), no vía trigger de Postgres. Si Fase 5 quiere mantener consistencia con el resto del código, el patrón esperado es el mismo: setear `updated_at`/`updated_by` en la Server Action de publicación, no un trigger nuevo.

### A.6 Conteo de filas

```
count = 0
```

La tabla está vacía en producción. No hay dato preexistente que condicione el diseño.

### A.7 Grants

Los grants de tabla son los defaults de Supabase (INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER otorgados a `anon`, `authenticated`, `service_role`, `postgres`). Esto es **normal y esperado**: en Supabase el control de acceso real vive en RLS (bloque A.4), no en los grants de tabla — los grants amplios son la config default del proyecto y así están en todas las demás tablas del esquema.

---

## B. Patrón de archivos (molde a reusar)

### B.1 Buckets de Storage

```
id: "documents"
public: false
file_size_limit: 10485760   (10 MB)
allowed_mime_types: [
  "image/jpeg", "image/png", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]
```

Un solo bucket, `documents`, privado. No existe un bucket separado para procedimientos. **Decisión pendiente para el prompt de build:** reusar `documents` con un prefijo de path distinto (ej. `procedimientos/{id}/...`) vs. crear un bucket nuevo `procedures`. Ninguna opción está implementada; no elijo acá.

El whitelist de MIME actual **no incluye `text/plain`** (`.txt`), que el PRD pide explícitamente como formato aceptado para procedimientos. Si se reusa el bucket `documents`, hace falta ampliar `allowed_mime_types` (a nivel bucket) y la whitelist en código (B.3). Si se crea un bucket nuevo, se define ahí. ⚠️ Contradicción con el PRD tal como está hoy — no implementado.

### B.2 Políticas de `storage.objects` (solo bucket `documents`)

```sql
-- storage_documents_delete (DELETE)
USING (bucket_id = 'documents' AND (SELECT is_admin()))

-- storage_documents_insert (INSERT)
WITH CHECK (
  bucket_id = 'documents' AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (SELECT is_admin())
  )
)

-- storage_documents_select (SELECT)
USING (
  bucket_id = 'documents' AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (SELECT is_admin())
  )
)
```

Lógica de path: el primer segmento de la ruta (`storage.foldername(name)[1]`) tiene que ser el `auth.uid()` del que sube, salvo que sea admin. Esto está pensado para documentos **personales** (`{profile_id}/...`), donde el dueño de la carpeta es el dueño del documento. **Para procedimientos esto no aplica tal cual**: los procedimientos no son propiedad de un empleado, son de lectura general. Si se reusa el bucket `documents`, estas tres políticas necesitan una condición nueva (ej. `bucket_id = 'documents' AND (storage.foldername(name))[1] = 'procedimientos' AND ...`) — no es un drop-in reuse, hay que tocar RLS de Storage. Otra razón a favor de evaluar un bucket separado en el prompt de build.

### B.3 `lib/storage.ts` (`/Users/lucianocr/Desktop/Dev/first-blades-app/lib/storage.ts`)

- `validateDocumentFile(file)` — líneas 34-42. Whitelist MIME (línea 11-18, `ALLOWED_MIME_TYPES`, un `Set` a nivel módulo — **no** parametrizable por caller hoy) y `MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024` (línea 20). Devuelve `{ ok: true } | { ok: false; error: string }` — contrato return-based (constitución §2.5, ver nota abajo).
- `createSignedUrl(storagePath)` — líneas 52-62. Usa `createAdminClient()` (service role), expiry fijo de 1 hora (línea 9, `SIGNED_URL_EXPIRY_SECONDS = 3600`). Nunca devuelve URL pública. Retorna `{ ok: true; url } | { ok: false; error }`.
- `uploadDocument(userId, file, documentType)` — líneas 75-97. Path: `{userId}/{documentType}-{timestamp}.{ext}` (línea 84). Acoplado a la semántica de "documento de un empleado" vía el primer segmento `userId` — coincide con la política de Storage de B.2. Para reusar este helper tal cual en Procedimientos habría que generalizar la firma (el primer segmento ya no sería un `userId`) o escribir un helper hermano.
- Todas las funciones públicas siguen el contrato return-based descrito en la constitución §2.5 ("las actions devuelven `{ ok, error }` en vez de tirar, para no depender de mensajes de `throw` redactados por Next.js en prod"), cerrado en Fase 4 sobre este mismo archivo tras un incidente de mensajes redactados en prod.

⚠️ **Inconsistencia detectada, no de esta tabla pero relevante para Fase 5:** `app/(app)/gestion-usuarios/actions.ts` (bloque E) **no** sigue el contrato return-based — usa `throw new Error(...)` en las tres actions (`createUser`, `updateUser`, `setUserStatus`). Si Fase 5 va a tocar este archivo (reseteo de contraseña, baja con motivo/fecha), es una oportunidad natural para preguntarle a Luciano si conviene migrarlo al contrato return-based de una — no lo decido acá, lo dejo para el prompt de build.

### B.4 Componente/flujo de subida en la UI de documentos

No se pidió explorar el componente de subida en detalle en este pase — no hay un componente "adjuntar archivo" en `components/ui`; la subida vive dentro del flujo de Mi Perfil (`app/(app)/mi-perfil/`). **No pude confirmar en este pase si hay un `<input type="file">` reutilizable desacoplado de `documents`** — habría que leer `app/(app)/mi-perfil/ProfileView.tsx` y los componentes de carga de documentos completos, que no llegué a inspeccionar línea por línea. Marcarlo como pendiente de revisión en el prompt de build si se decide reusar el flujo de subida de UI, no solo el backend de Storage.

### B.5 Trigger `storage.protect_delete()`

**Sigue presente**, sin scope a un bucket en particular:

```sql
CREATE OR REPLACE FUNCTION storage.protect_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$function$
```

Implicación para tests: cualquier test de integración que intente borrar filas de `storage.objects` directamente por SQL (en vez de usar la Storage API) va a fallar con `42501`, sea cual sea el bucket. Los tests de Fase 5 para archivos de procedimientos tienen que usar la Storage API (o `storage.allow_delete_query`) igual que ya lo hacen los tests de `documents` — mismo patrón, sin sorpresas nuevas.

---

## C. `audit_log` — cómo se escribe hoy (bloque crítico)

### C.1 Forma real de la tabla

| Columna | Tipo | Nullable |
|---|---|---|
| `id` | `uuid` | NO (default `gen_random_uuid()`) |
| `actor_id` | `uuid` | **YES** |
| `action` | `text` | NO |
| `table_name` | `text` | NO |
| `record_id` | `uuid` | NO |
| `old_data` | `jsonb` | YES |
| `new_data` | `jsonb` | YES |
| `created_at` | `timestamptz` | NO (default `now()`) |

### C.2 Políticas RLS

`relrowsecurity = true`, `relforcerowsecurity = false`.

```sql
-- audit_log_select_admin (SELECT, única policy existente)
USING ((SELECT is_admin()))
```

**No hay ninguna policy de INSERT** para `authenticated` ni para nadie. Confirmado también por `migration.test.ts:554-558`, que afirma exactamente `['audit_log_select_admin']` como el inventario completo de policies (test de drift que ya existe y pasaría igual hoy).

### C.3 Todos los caminos por los que hoy se escribe en `audit_log`

Un solo camino, indirecto:

- **`public.log_audit(p_action text, p_table_name text, p_record_id uuid, p_old_data jsonb DEFAULT NULL, p_new_data jsonb DEFAULT NULL)`** — función `SECURITY DEFINER`, `search_path` fijo a `public`, definida así:

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

  **Grep en todo `app/` y `lib/` no encontró ningún caller de `log_audit` en código de la aplicación** — el único hit es la firma generada en `supabase/types.ts:639`. Es decir: **la función existe en la base desde alguna migración anterior, pero hoy ningún flujo de la app la usa.** Nada queda hoy en `audit_log` en la práctica (coherente con que la tabla `procedures` esté vacía y con que no haya otro INSERT path).

  ⚠️ **Hallazgo de seguridad no relacionado con Fase 5 pero real:** el advisor de seguridad de Supabase reporta que `log_audit()` es ejecutable vía RPC (`/rest/v1/rpc/log_audit`) por **`anon` y `authenticated`**, y la función **no verifica `is_admin()` ni ningún rol adentro** — solo usa `auth.uid()` como `actor_id`. Cualquier usuario autenticado (no solo admin) podría invocar `log_audit(...)` hoy mismo vía REST con `table_name`/`record_id`/`action` arbitrarios y escribir filas falsas en `audit_log`, pese a que la tabla es de solo-lectura para no-admin vía RLS. No lo toco (fuera de alcance de este prompt), pero lo marco porque si Fase 5 termina reusando `log_audit()` para la publicación de procedimientos, hereda esta falta de guarda — ver opción abajo.

- **No hay ningún trigger** en ninguna tabla (`ausencia_requests`, `pasaje_requests`, `procedures`, etc.) que escriba en `audit_log`.
- **No hay ningún uso de `createAdminClient()` (service role) para insertar en `audit_log`** en el código actual — grep no encontró ningún `.from('audit_log').insert(...)` en `app/` ni `lib/`.

### C.4 Conclusión explícita

**Con la RLS actual, un admin logueado vía `createServerClient()` NO puede insertar en `audit_log` directamente** — no existe policy de INSERT para ningún rol, así que Postgres deniega por default (RLS habilitada sin policy matching = deny).

Sí existe, sin embargo, un camino ya construido que **si** se decide usar, evita escribir código de acceso a la base nuevo: la RPC `log_audit()` (`SECURITY DEFINER`), aunque hoy nadie la llama y tiene la falta de guarda interna de C.3.

Opciones que veo para que la publicación de un procedimiento quede en `audit_log` (**no implemento ninguna — decisión de Luciano en el prompt de build**):

| Opción | Pro | Contra |
|---|---|---|
| **(a) Nueva policy de INSERT en `audit_log` acotada a admin** (`WITH CHECK (is_admin())`) | Simple, consistente con el patrón de `procedures_write_admin`; la Server Action hace un `.insert()` normal vía `createServerClient()`, sin RPC. | Abre la tabla a INSERT directo desde cualquier código futuro con sesión admin, no solo desde el flujo de publicación — más superficie que una RPC acotada. |
| **(b) RPC `SECURITY DEFINER` chica y específica** (ej. `log_procedure_publish(...)`), con guarda `is_admin()` adentro | Acotada al caso de uso exacto; no reabre `audit_log` en general; puede validarse en el mismo `CREATE OR REPLACE` con un test de drift como los que ya existen para `resolver_ausencia_request` (`migration.test.ts:485-520`). | Una función más para mantener; hay que decidir si conviene fusionarla con el propio INSERT/UPDATE de `procedures` en una sola RPC atómica (como se hizo en FB-ADJ-02, migración 0019) o dejarlas separadas. |
| **(c) Trigger `AFTER INSERT/UPDATE` en `procedures`** que llame internamente a algo equivalente a `log_audit` | Cero cambio en la Server Action — la auditoría es automática y no se puede "olvidar" en un caller futuro. | Contradice la convención real del repo (bloque A.5: cero triggers hoy, todo se maneja desde la Server Action); requeriría lógica extra para distinguir INSERT vs UPDATE dentro del trigger; más difícil de testear con el patrón de `migration.test.ts` actual. |
| **(d) Reusar `log_audit()` tal cual desde la Server Action de publicación** (ya que es `SECURITY DEFINER` y callable por `authenticated`) | Cero migración nueva para esto puntual — funciona hoy. | Hereda la falta de guarda interna de C.3 (cualquier `authenticated`, no solo admin, podría llamarla igual desde REST aunque la Server Action solo la use para admin); no valida `p_table_name`/`p_record_id` contra nada. |

Ninguna de estas cuatro está implementada. Frenar acá y decidir en el prompt de build, tal como pide el prompt de inspección.

---

## D. `profiles` y el flujo de inactivación

### D.1 `motivo_baja` / `fecha_baja`

**Confirmado: no existen.** Columnas reales de `profiles`:

```
id, email, full_name, role, status, supervisor_id, phone, dni,
fecha_ingreso, entrevista_tecnica, created_at, updated_at, cuit, winda_id
```

Ninguna coincide con `motivo_baja` ni `fecha_baja`.

### D.2 Columna de estado

- Nombre: `status`
- Tipo: enum `employee_status`, `NOT NULL`, default `'activo'::employee_status`
- Valores del enum: `activo`, `inactivo`, `pendiente`

### D.3 Dónde vive hoy la acción de cambiar el estado

`app/(app)/gestion-usuarios/actions.ts`:

```ts
export async function setUserStatus(userId: string, status: EmployeeStatus) {
  await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw new Error(error.message);

  revalidatePath('/gestion-usuarios');
}
```

(líneas 72-84). También existe `updateUser` (líneas 52-70), que puede cambiar `status` como parte de una edición general.

⚠️ **No usa el contrato return-based** (`throw new Error(...)` en vez de `{ ok, error }`) — ver nota en B.3. `setUserStatus` hoy solo recibe `userId` y `status`; no tiene parámetros para motivo ni fecha, coherente con que esas columnas no existen todavía.

### D.4 Validaciones / efectos secundarios al inactivar

**Ninguno.** Reviso `lib/auth.ts` (`requireAuth`, líneas 8-27): valida que exista `auth.getUser()` y que exista una fila en `profiles` con ese `id` — **no verifica `status`**. `requireRole`/`requireAdmin`/`requireSupervisor` (líneas 29-41) delegan en `requireAuth` y solo comparan `role`.

⚠️ **Un usuario con `status = 'inactivo'` hoy puede seguir logueándose y usando la app con normalidad** — la inactivación es puramente un flag de datos en `profiles`, no afecta la sesión de Supabase Auth ni está gateada en `requireAuth()`. RLS de `profiles` tampoco filtra por `status` en la policy `profiles_select` (bloque D.2/E, ver política transcripta: solo compara `id = auth.uid()` / rol / `supervisor_id`).

Esto es exactamente lo que el prompt pidió confirmar explícitamente. Lo marco como riesgo para la sección final — no lo resuelvo acá (podría ser intencional: "baja" administrativa sin revocar acceso inmediato, o podría ser un gap real a cerrar en Fase 5).

---

## E. Alta de usuario y Supabase Auth admin (molde del reseteo)

### E.1 Dónde y cómo se crea un usuario

`app/(app)/gestion-usuarios/actions.ts:17-42`:

```ts
export async function createUser(input: CreateUserInput) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.initial_password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });

  if (authError) throw new Error(authError.message);

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: input.full_name,
      role: input.role,
      supervisor_id: input.role === 'empleado' ? (input.supervisor_id ?? null) : null,
    })
    .eq('id', data.user.id);

  if (profileError) throw new Error(profileError.message);

  revalidatePath('/gestion-usuarios');
}
```

Usa `admin.auth.admin.createUser(...)` de `createAdminClient()` (`lib/supabase/admin.ts`, service role, bypassea RLS por completo).

**Verificación server-side de que quien llama es admin:** `await requireAdmin()` en la primera línea de la action (`lib/auth.ts:35-37`) — llama `requireRole('admin')`, que hace `requireAuth()` (valida sesión real vía `supabase.auth.getUser()` contra el servidor, no confía en cookies sin validar) y compara `profile.role !== 'admin'` → `redirect('/dashboard')` si no matchea. Esto corre **antes** de instanciar `createAdminClient()`, así que ningún no-admin llega al service role. Es el mismo guard (`requireAdmin`) que ya usan `updateUser` y `setUserStatus`.

### E.2 Reglas de contraseña vigentes

**No encontré ninguna validación de longitud mínima ni complejidad**, ni en cliente ni en servidor. En `UserFormModal.tsx:72-73` la única validación es que el campo no esté vacío:

```ts
if (!password) {
  setError(copy.gestionUsuarios.passwordRequired);
  ...
}
```

`createUser` (E.1) pasa `input.initial_password` directo a `admin.auth.admin.createUser(...)` sin validar longitud/formato en el server tampoco. La única regla de contraseña que podría aplicar es la que tenga configurada Supabase Auth a nivel proyecto (mínimo de caracteres por default de GoTrue) — **no la pude verificar con las herramientas de solo-lectura disponibles en este pase** (no hay una tool MCP para leer la config de Auth del proyecto); habría que confirmarlo en el dashboard de Supabase o documentar el default de GoTrue (8 caracteres) como supuesto a validar en el build.

El advisor de seguridad sí reporta algo relacionado y accionable: **`auth_leaked_password_protection` está deshabilitado** (WARN) — Supabase Auth no está chequeando contraseñas contra HaveIBeenPwned. No es bloqueante para Fase 5, pero es una mejora de seguridad barata si se toca esta pantalla.

### E.3 Helper de "guarda de admin" reutilizable

Sí, existe y ya se reusa: `requireAdmin()` en `lib/auth.ts:35-37`, usado consistentemente en las tres actions de `gestion-usuarios/actions.ts` (`createUser`, `updateUser`, `setUserStatus`) y en `app/(app)/aprobaciones/actions.ts` / `ausencia-actions.ts` (confirmado por el grep de B/E, aunque no leí esos archivos línea por línea en este pase). No hace falta crear un guard nuevo para reseteo de contraseña — el mismo `requireAdmin()` alcanza.

### E.4 ¿La creación de usuario queda en `audit_log` hoy?

**No.** `createUser`, `updateUser` y `setUserStatus` no llaman a `log_audit()` ni insertan en `audit_log` de ninguna forma — confirmado por lectura completa del archivo (bloque C.3 ya estableció que no hay ningún caller de `log_audit` en toda la app). Si Fase 5 espera que la baja de usuario o el reseteo de contraseña queden auditados, hoy no hay precedente de cómo se vería eso en código — la decisión del bloque C aplica también acá si se quiere una convención común.

---

## F. Menú, rutas y sistema de diseño

### F.1 Ítem "Procedimientos"

Existe en `components/layout/Sidebar.tsx:33`:

```ts
{ key: 'procedimientos', label: copy.nav.procedimientos, href: '/procedimientos', icon: FileText, roles: ['admin', 'supervisor', 'empleado'] },
```

Los 3 roles lo ven, coincide con el PRD (admin gestiona, supervisor/empleado leen).

Ruta: `app/(app)/procedimientos/page.tsx` — **es placeholder**:

```tsx
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function Page() {
  return <PlaceholderPage />;
}
```

### F.2 Componentes del sistema de diseño disponibles

`components/ui/`:

- `Table.tsx` — tabla base.
- `StatusBadge.tsx` — badge de estado (hoy con los estados Pendiente/Aprobado/Rechazado del patrón Purgatorio; para Fase 5 hay que confirmar en el build si acepta un estado "Nuevo"/"Archivado" custom o si hace falta una variante).
- `Modal.tsx` — modal base, reusable para previsualización.
- `Input.tsx` — input genérico (no hay un `SearchInput` dedicado, ver F.4).
- `Textarea.tsx` — para el contenido de texto libre y para `motivo_baja`.
- `Select.tsx`, `DatePicker.tsx`, `Button.tsx`, `Card.tsx`, `InfoBanner.tsx`, `CollapsibleSection.tsx` — también disponibles; `DatePicker.tsx` es el candidato directo para `fecha_baja`.

Todos son reusables tal cual (no encontré nada acoplado a un módulo particular en este pase).

### F.3 `/lib/copy` — estructura y convención

Un único archivo: `lib/copy/index.ts`. Convención: un objeto `copy` exportado con namespaces de primer nivel por módulo (`copy.general`, `copy.auth.login`, `copy.nav`, `copy.gestionUsuarios`, `copy.documentos`, etc.). No hay archivos separados por módulo — agregar Fase 5 significa sumar una clave nueva (ej. `copy.procedimientos`) dentro del mismo `index.ts`, siguiendo el patrón ya usado por `copy.gestionUsuarios` (namespace con sub-objeto `form` para labels de formulario, y claves de error/validación planas).

### F.4 Patrón de búsqueda existente

**No hay ningún patrón de búsqueda real implementado** (ni `ilike` en ninguna query de Supabase del lado app, ni un input de búsqueda con debounce). Lo único que se acerca es filtrado client-side simple sobre arrays ya cargados:

- `app/(app)/gestion-usuarios/page.tsx:31` — `users.filter(...)` para armar la lista de supervisores disponibles en el form (no es "búsqueda", es un filtro de rol).
- `app/(app)/equipo/utils.ts:157,168` — filtros de documentos por fecha de vencimiento y de perfiles, mismo patrón: `.filter()` client-side sobre datos ya traídos, sin texto libre.

Si Fase 5 quiere búsqueda por texto en Procedimientos (título/categoría/contenido), es una pieza nueva — no hay nada para reusar tal cual. Esto refuerza la pregunta de G.3 sobre si conviene instalar `pg_trgm`.

---

## G. Base de datos: contexto para la migración

### G.1 Última migración aplicada / próximo número

Última: `0019_admin_crear_aprobar.sql` (nombre lógico `admin_crear_aprobar`). **La próxima migración es `0020`.**

### G.2 `migration list`: Local = Remote

```
   Local | Remote | Time (UTC)
  -------|--------|------------
   0001  | 0001   | 0001
   ...
   0019  | 0019   | 0019
```

Confirmado — Local y Remote coinciden exactamente en las 19 migraciones (`0001` a `0019`). Sin drift.

### G.3 Extensiones instaladas

- **`btree_gist`** — instalada (`schema: extensions`, versión `1.7`). Usada hoy por la exclusion constraint de no-solapamiento de ausencias (migración 0014).
- **`pg_trgm`** — **NO instalada** (`installed_version: null` en `list_extensions`; solo está disponible como `default_version: "1.6"`). Si Fase 5 quiere búsqueda difusa/`ILIKE`-acelerada por trigram sobre `procedures.title`/`category`/`content`, hace falta instalarla en la migración de Fase 5 — no está ya disponible como asumía el contexto del prompt.

### G.4 Convención real del drift detector (`tests/integration/migration.test.ts`)

Un solo archivo (`tests/integration/migration.test.ts`, 1000 líneas), corrido contra Supabase local en CI (job "Tests de integración RLS"), con `describe.skipIf(!dbAvailable)`. El patrón, migración por migración, es:

1. **Inventario de tablas esperado** (`expectedTables`, líneas 28-38) — `procedures` y `audit_log` ya están en la lista (agregadas en migraciones previas), así que **no hace falta tocar esa lista** para Fase 5 salvo que se agregue una tabla nueva.
2. Por cada migración nueva, un bloque de `it()` que valida:
   - Columnas nuevas: `data_type`, `is_nullable`, a veces `column_default` o `character_maximum_length`, vía `information_schema.columns`.
   - Constraints (CHECK/UNIQUE/EXCLUDE): se valida la **definición completa** con `pg_get_constraintdef(oid)` cuando es determinística (`toBe(...)` exacto), o por **componentes semánticos** con `toMatch(...)` cuando Postgres normaliza de forma dependiente de versión (casts de enum, literales de rango) — el criterio documentado explícitamente en varios comentarios (ej. líneas 200-203, 583-593) es "no alcanza con que exista algo, se valida la forma exacta".
   - Índices: `pg_indexes`, con `indexname`/`indexdef` exactos cuando son determinísticos.
   - Policies: inventario **exacto** por tabla (`toEqual([...nombres...])`, no solo "existe alguna") — ver líneas 246-253, 554-558, 735-747, etc. Si Fase 5 agrega una policy a `procedures` o `audit_log`, **hay que actualizar el `toEqual` existente de esa tabla**, no solo agregar un test nuevo, porque el test viejo fallaría por inventario incompleto.
   - Enums: inventario exacto vía `toEqual([...])` sobre `pg_type`/`typtype = 'e'` — agregar un enum nuevo (o valores a uno existente) rompe los `toEqual` ya escritos en 6+ lugares del archivo si no se actualizan todos.
   - Funciones `SECURITY DEFINER`: firma (`pronargs`, `pronargdefaults`, tipos de argumento, retorno), `prosecdef = true`, `proconfig` con `search_path=public`, owner consistente con `is_admin()`/`auth_role()`, y grants de `EXECUTE` explícitos (`authenticated: true, anon: false, public: false`) — este patrón se repite para cada RPC nueva (`resolver_ausencia_request`, `resolver_pasaje_request`, `cancelar_editar_*`). **Si Fase 5 termina con una RPC nueva (opción (b)/(d) del bloque C), va a necesitar el mismo bloque de tests.**
3. Bloques de "delta puro" que reafirman que RLS/enums de tablas **no tocadas** por la migración en cuestión siguen intactos — sirve como red de seguridad contra cambios accidentales.

**Qué hay que agregarle para Fase 5:** un bloque nuevo de `it()` para la migración `0020` (o las que correspondan) cubriendo: columnas nuevas de `procedures` (archivado, lo que se decida) y de `profiles` (`motivo_baja`, `fecha_baja`), cualquier CHECK nuevo, el inventario actualizado de policies de `procedures` y (si aplica) `audit_log`, y si se instala `pg_trgm`, un test análogo al de `btree_gist` (líneas 563-571) confirmando `pg_extension`.

---

## H. Estado del repo

### H.1 `git status`

- Rama actual (esta inspección): `fase-5/f5-01-inspect`, creada desde `origin/main` (limpio, sin ahead/behind al momento de crearla).
- Working tree: limpio salvo untracked (ver H.3) más el propio `docs/prompts/FB-F5-01-INSPECT.md` de esta tarea.
- Ramas locales: además de `main` y `fase-5/f5-01-inspect`, hay ~20 ramas de feature de fases anteriores (`feat/fb-f3-*`, `fb-f4-*`, etc.) — no las inventarío en detalle, son historial de trabajo ya mergeado o en curso, no bloquean nada de Fase 5.
- **PRs abiertos:** solo uno — **#26**, `docs: versionar FB-F4-09.md`, rama `docs/fb-f4-09-prompt`, estado `OPEN` desde 2026-07-28. No tiene relación con Fase 5. No lo toco.

### H.2 Drift entre `main` local y `origin/main`

⚠️ La rama local `main` (no la rama de esta inspección, sino la rama literal `main` del checkout local) está **7 commits atrás** de `origin/main`: le faltan, entre otros, `f20e27f` (FB-ADJ-01) hasta `0e326a4` (merge de PR #37, FB-ADJ-01/02). Es decir, el `main` local no se actualizó desde el último trabajo mergeado. Esto no afecta a esta inspección (que se ramificó directo de `origin/main`, actualizado), pero vale la pena que alguien corra `git fetch && git checkout main && git pull` en el checkout local para no confundirse en el futuro. No lo hice yo porque no es parte del alcance de este prompt (no se pidió tocar la rama `main` local) y cambiar la rama en la que está parado el usuario sin que la pidiera podría interferir con trabajo en curso.

### H.3 `docs/pdr-fase-4.md`

Confirmado: sigue **untracked**, no lo toqué. (`docs/pdr-fase-5.md` también aparece untracked en el `git status` — no estaba en el alcance de "no tocar" explícito del prompt, pero tampoco lo toqué: no es parte del entregable de este prompt y no hay indicación de qué hacer con él.)

### H.4 Estado de CI en `main`

3 jobs confirmados en `.github/workflows/ci.yml`:

1. `Typecheck · Lint · Tests · Build`
2. `Tests de integración RLS (Supabase local)`
3. `E2E Playwright (stack efímero)`

Últimas 3 corridas en `main`, todas **`success`**:

```
0e326a4  Merge PR #37 — FB-ADJ-01/02 ...        CI  success  3m56s  2026-08-04T13:08:38Z
8b1b2e9  Merge PR #36 — FB-F4-21 ...             CI  success  3m41s  2026-08-03T17:31:01Z
7c9...   Merge PR #35 — FB-F4-20 ...             CI  success  3m46s  2026-08-03T15:18:27Z
```

(El listado de `gh run list` agrupa los 3 jobs bajo un solo workflow "CI" por corrida; no hay corridas rojas recientes en `main`.)

---

## Confirmación de alcance respetado

- ❌ Ninguna migración aplicada.
- ❌ Ningún `supabase db push`.
- ❌ Ninguna escritura en la base (todas las consultas fueron `SELECT` / lecturas de catálogo; se usó `execute_sql` exclusivamente con queries de lectura contra `information_schema` y `pg_catalog`).
- ❌ Ningún cambio de código de feature.
- ❌ `supabase/types.ts` no se tocó.
- ✅ Único archivo nuevo de código/config: este informe y el prompt versionado en `docs/prompts/`.

---

## Riesgos y decisiones que le quedan al Developer

1. **`audit_log` sin policy de INSERT** (bloque C): hay que elegir entre policy nueva de INSERT admin-only, RPC `SECURITY DEFINER` chica, trigger en `procedures`, o reusar la `log_audit()` existente (que hoy es invocable por cualquier `authenticated`, no solo admin, sin guarda interna). La elección condiciona si la migración de Fase 5 toca `audit_log` o no.
2. **`procedures` no tiene columna de archivado.** Hay que definir su nombre/tipo, y decidir si `procedures_select_all` (bloque A.4) se edita para excluir archivados a no-admin, o si el filtro se hace solo en la query de lectura de la app.
3. **`procedures` no tiene CHECK de "al menos content o storage_path"** — decidir si se aplica a nivel base (CHECK) o solo en la Server Action.
4. **Bucket de Storage para archivos de procedimientos:** reusar `documents` (requiere tocar 3 policies de `storage.objects` y ampliar el whitelist de MIME para incluir `text/plain`) vs. bucket nuevo dedicado.
5. **`pg_trgm` no está instalado** — si se quiere búsqueda por trigram, hay que instalarlo explícitamente en la migración; hoy no hay ningún patrón de búsqueda por texto en el repo para reusar.
6. **Reseteo de contraseña:** no hay validación de longitud/complejidad hoy en ningún punto (cliente ni servidor) — decidir si Fase 5 introduce una regla mínima, y si aplica tanto a alta como a reseteo.
7. **`profiles.status = 'inactivo'` no bloquea el login hoy** (`requireAuth()` no lo verifica). Confirmar si esto es aceptable para "Baja" (label puramente administrativo) o si Fase 5 espera que un inactivo pierda acceso — de ser lo segundo, es un cambio en `lib/auth.ts`, no solo una migración.
8. **`gestion-usuarios/actions.ts` no sigue el contrato return-based** (§2.5) — evaluar si migrarlo de una vez que se va a tocar este archivo para reseteo y baja.
9. **Creación de usuario no queda en `audit_log` hoy** — si se decide auditar el reseteo de contraseña y la baja, definir si también se retrofittea la creación, o si queda deliberadamente fuera de alcance de Fase 5.
10. **`drift detector` (`migration.test.ts`):** cualquier policy o enum nuevo en tablas ya cubiertas por un `toEqual([...])` existente rompe ese test si no se actualiza a la vez — no es opcional, es mecánico.
