# FB-PI-06-PREFLIGHT — Purga del usuario inactivo `santiago@agenciakairos.net`

> **Inventario reconfirmado contra producción: coincide con el prompt en los 8 elementos.** Aparecieron dos datos que no estaban en el inventario y **no bloquean**: (1) uno de sus 2 documentos tiene `uploaded_by` = él mismo (FK `NO ACTION`, se resuelve con el orden de borrado); (2) **3 entradas de `audit_log` lo mencionan como `record_id`**. Se conservan: `record_id` no tiene FK.
>
> **Nada se ejecutó.** Este paso fue solo lectura. Cada paso del runbook (§7) requiere autorización explícita de Luciano.

- **Fecha:** 2026-10-06
- **Rama:** `docs/fb-pi-06-purga-santiago` (desde `main` @ `da081a6`)
- **Prompt:** `docs/prompts/FB-PI-06.md` (Paso 0)
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** 4 consultas `SELECT` de solo lectura contra producción (proyecto `simfemdkrkdbumefcxei`) vía el conector de Supabase: catálogo de FKs, inventario, documentos/Storage/`audit_log`/triggers y totales/remanente. Sin escrituras.

---

## 1. Inventario reconfirmado

Perfil: `id = 03744042-0a64-435d-933f-b35d68f473b8`, `full_name = "David"`, rol `empleado`, estado `inactivo`, `fecha_baja = 2026-09-07`, `motivo_baja = "Desafectación"`.

| Elemento | Prompt | Producción | ✔ |
|---|---|---|---|
| Perfil en `profiles` (por email) | 1 | 1 | ✔ |
| Usuario en `auth.users` (por email / mismo `id`) | 1 | 1 / 1 | ✔ |
| Días en `rotation_assignments` | 46 (01/07 → 11/09) | **46** (2026-07-01 → 2026-09-11) | ✔ |
| Documentos en `documents` | 2, con archivo | 2, los 2 con objeto en Storage | ✔ |
| Ausencias / pasajes (propios, como solicitante o empleado) | 0 | 0 / 0 | ✔ |
| Procedimientos creados o editados | 0 | 0 | ✔ |
| `audit_log` como actor | 0 | 0 | ✔ |
| Empleados a cargo (`supervisor_id`) | 0 | 0 | ✔ |

Además, fuera del inventario del prompt:

| Elemento | Producción | Impacto |
|---|---|---|
| Revisiones hechas por él (`reviewed_by` en documentos, ausencias y pasajes) | 0 | — |
| Documentos subidos por él para otra persona | 0 | — |
| Documentos propios subidos por él mismo (`uploaded_by` = él) | **1** (el certificado rechazado) | FK `NO ACTION`: ver §2 y §6 |
| `notification_log` (como empleado o destinatario) | 0 | — |
| `auth.identities` | 1 | `CASCADE` desde `auth.users` |
| `auth.sessions` / `mfa_factors` / `one_time_tokens` | 0 / 0 / 0 | — |
| `audit_log` que lo mencionan como `record_id` | **3** | Se conservan (§5) |
| Objetos de Storage con `owner` = él | 0 | — |

**Totales de producción antes de la purga** (para comparar en la verificación posterior): `profiles` 28 · `auth.users` 28 · `rotation_assignments` 69 · `documents` 4 · objetos del bucket `documents` 4 · `audit_log` 19 · `ausencia_requests` 2 · `pasaje_requests` 0.

## 2. Dependencias de clave foránea (catálogo `pg_constraint`)

**Hacia `public.profiles(id)`:**

| Tabla.columna | `ON DELETE` | Filas de Santiago | Efecto si se borra el perfil |
|---|---|---|---|
| `rotation_assignments.user_id` | CASCADE | 46 | Se borrarían en cascada |
| `documents.user_id` | CASCADE | 2 | Se borrarían en cascada |
| `documents.uploaded_by` | **NO ACTION** | 1 (su propio documento) | Bloquearía si la fila siguiera viva al final de la sentencia. Como la cascada de `user_id` la borra en la misma sentencia, no bloquea; igual se borra antes, de forma explícita (§6) |
| `documents.reviewed_by` | NO ACTION | 0 | — |
| `ausencia_requests.user_id` | CASCADE | 0 | — |
| `ausencia_requests.reviewed_by` | NO ACTION | 0 | — |
| `pasaje_requests.solicitante_id` / `empleado_id` | CASCADE | 0 | — |
| `pasaje_requests.reviewed_by` | NO ACTION | 0 | — |
| `procedures.created_by` / `updated_by` | NO ACTION | 0 | — |
| `audit_log.actor_id` | **SET NULL** | 0 | No modifica ninguna fila de auditoría |
| `notification_log.empleado_id` / `recipient_profile_id` | CASCADE | 0 | — |
| `profiles.supervisor_id` | SET NULL | 0 a cargo | — |

**Hacia `auth.users(id)`:** `profiles.id` → **CASCADE**; `auth.identities`, `sessions`, `mfa_factors`, `one_time_tokens`, `oauth_*`, `webauthn_*`, `mfa_recovery_code_sets` → CASCADE; `auth.scim_users` → SET NULL.

**Ningún `NO ACTION` con filas de Santiago bloquea**, salvo el `uploaded_by` de su propio documento, que se resuelve borrando los documentos antes que el perfil.

## 3. Relación `profiles` ↔ `auth.users`

- `profiles.id` es FK a `auth.users(id)` con **`ON DELETE CASCADE`**: borrar el usuario de Auth **arrastra el perfil**, y con él todo lo que cuelga en cascada del perfil.
- Al revés no: borrar el perfil **no** borra el usuario de Auth.
- Trigger en `auth.users`: solo `on_auth_user_created` (AFTER INSERT). No hay triggers de borrado.

**Propuesta:** borrar el usuario con la **API de Auth Admin** (`auth.admin.deleteUser(id)`, borrado duro), no por SQL sobre `auth.users`, que es un esquema administrado por GoTrue. La cascada borra el perfil y la identidad; la verificación confirma ambos en 0.

## 4. Archivos en Storage (bucket `documents`)

| `storage_path` | Documento | Estado | Tamaño | Existe |
|---|---|---|---|---|
| `03744042-0a64-435d-933f-b35d68f473b8/certificado-1782319788283.pdf` | `9dd032b3-a035-4542-978b-053a7a4e88e8` (certificado) | `rechazado` | 62 786 B | ✔ |
| `03744042-0a64-435d-933f-b35d68f473b8/estudio_medico-1782319920541.docx` | `02f0a354-f186-4ab8-9615-3efab6901481` (estudio médico) | `aprobado` | 38 365 B | ✔ |

- `storage.objects` tiene el trigger **`protect_objects_delete`** (BEFORE DELETE): confirma que los archivos se borran **con la API de Storage**, nunca con un `DELETE` por SQL.
- Ningún objeto tiene `owner` = Santiago (no hay FK de `storage.objects` hacia él).

**⚠️ Hallazgo lateral, fuera de alcance:** el certificado está `rechazado` desde el 24/06 (más de 30 días) y su archivo **no fue purgado** (`file_purged_at` nulo). El cron `purge-rejected-docs` (diario, `vercel.json`) tendría que haberlo borrado. Sumado a las 19 filas pasadas que siguen con `es_estimado = true` (cron `promote-estimated-days`), **todo indica que los crons de Vercel no están corriendo, o fallan, en producción** (por ejemplo, por falta de `CRON_SECRET`). Va al Log como item propio.

## 5. `audit_log`

- **Como actor: 0 entradas.** La FK `audit_log.actor_id` es `SET NULL`, así que borrar el perfil **no modifica ninguna fila de auditoría**.
- **Lo mencionan como `record_id`: 3 entradas.** Se conservan intactas:

| `audit_log.id` | Tabla | Acción | Fecha |
|---|---|---|---|
| `4f542c8e-1ac9-4798-b1b6-53a246068c2e` | `documents` | `document_rejected` | 2026-06-24 |
| `902abd51-80e0-40c5-8e75-7b94b17236c3` | `profiles` | `password_reset` | 2026-08-07 |
| `75f7a351-c3ad-44c6-9635-303efa55fdf9` | `profiles` | `user_deactivated` | 2026-09-07 |

- **Ninguna FK impide conservarlas:** `audit_log.record_id` (uuid) no tiene FK. Van a quedar apuntando a IDs que ya no existen, y eso es correcto: son la bitácora de algo que después se purgó.
- No hay entradas de auditoría de sus días de calendario.

## 6. Orden de borrado propuesto

1. **Snapshot** (§7, Paso 1). Nada se borra sin él.
2. **Archivos de Storage** (API de Storage). Van primero porque, mientras existan las filas de `documents`, cada archivo queda atado a su `storage_path`. Si la API falla, la base no cambió y se reintenta. Si se borraran antes las filas, una falla dejaría **archivos huérfanos sin referencia** en la base.
3. **`rotation_assignments`** (46): explícito, con conteo antes y después.
4. **`documents`** (2): explícito. Saca también la autorreferencia `uploaded_by` antes de tocar el perfil.
5. **Usuario de Auth** (API de Auth Admin): la cascada borra `profiles` (1) y `auth.identities` (1). Al llegar acá no queda ninguna fila que dependa del perfil.

Los pasos 3 y 4 los cubriría la cascada del paso 5. Se hacen explícitos para tener un **conteo exacto por tabla** y para que nada se borre "de rebote" sin verse.

## 7. Runbook (cada paso, solo con autorización explícita de Luciano)

### Paso 1 — Snapshot

**Dónde:** carpeta local **fuera del repo**: `~/Desktop/Dev/first-blades-backups/FB-PI-06-2026-10-06/`. No se commitea: contiene datos personales (DNI, CUIT, teléfono) y los archivos del empleado. Luciano decide si además la copia a un lugar con backup.

**Qué (formato JSON, más los binarios):**

| Archivo | Contenido |
|---|---|
| `profile.json` | Fila completa de `profiles` |
| `auth_user.json` | `auth.users` del id **sin secretos** (sin `encrypted_password` ni tokens): id, email, fechas, `raw_user_meta_data`, `raw_app_meta_data`; más la fila de `auth.identities` |
| `rotation_assignments.json` | Las 46 filas completas |
| `documents.json` | Las 2 filas completas |
| `storage/…` | Los 2 archivos descargados con la API de Storage, con su `storage_path` |
| `audit_log_referencias.json` | Las 3 entradas que lo mencionan (referencia; no se borran) |
| `manifest.json` | Conteos, `sha256` de cada archivo y fecha y hora del snapshot |

**Cómo:** un script local (`tsx`) con `createAdminClient()`, que usa la service role de `.env.local`. Solo lee y descarga; corre desde el scratchpad de la sesión y no se commitea. Al terminar, **verifica** que los conteos del manifest den 1/1/46/2/2 y que los `sha256` de los archivos coincidan con lo descargado.

**Reconstrucción, si hiciera falta:** filas de `public.*` con `INSERT` desde los JSON (los `id` se preservan). Archivos con `upload` al mismo `storage_path`. Usuario de Auth con el mismo `id`, insertado como hacen los tests de integración, o recreado por invitación. **La contraseña no se recupera** (el snapshot no guarda secretos): habría que resetearla. Es aceptable para un usuario dado de baja.

### Paso 2 — Archivos de Storage

- Pre-check (SQL): los 2 objetos existen en `storage.objects` con esos `name`.
- Ejecución (script, service role): `storage.from('documents').remove([<los 2 storage_path>])`.
- Post-check (SQL): 0 objetos con prefijo `03744042-…/`; el bucket `documents` pasa de 4 a 2.

### Paso 3 — Datos de la base

**3a y 3b**, por SQL, cada uno en un bloque atómico que **aborta si el conteo no es el esperado**:

```sql
DO $$
DECLARE n int; uid uuid := '03744042-0a64-435d-933f-b35d68f473b8';
BEGIN
  SELECT count(*) INTO n FROM public.rotation_assignments WHERE user_id = uid;
  IF n <> 46 THEN RAISE EXCEPTION 'FB-PI-06: se esperaban 46 días, hay %', n; END IF;
  DELETE FROM public.rotation_assignments WHERE user_id = uid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 46 THEN RAISE EXCEPTION 'FB-PI-06: se borraron % días, se esperaban 46', n; END IF;
END $$;
```

El 3b es igual para `public.documents WHERE user_id = uid`, esperando **2**.

**3c**, con la API de Auth Admin:

- Pre-check: el perfil existe con ese email, `status = 'inactivo'` y `role = 'empleado'`, y no le quedan documentos ni días.
- Ejecución (script, service role): `auth.admin.deleteUser('03744042-0a64-435d-933f-b35d68f473b8')`. Por cascada borra `profiles` (1) y `auth.identities` (1).

### Paso 4 — Verificación posterior

| Medida | Antes | Esperado después |
|---|---|---|
| `profiles` | 28 | **27** |
| `auth.users` | 28 | **27** |
| `rotation_assignments` | 69 | **23** |
| `documents` | 4 | **2** |
| Objetos del bucket `documents` | 4 | **2** |
| `audit_log` | 19 | **19**, con las 3 entradas de §5 intactas |
| Email en `profiles` / `auth.users` | 1 / 1 | **0 / 0** |

- **Remanente de calendario de prueba** (objeto del próximo trabajo): **23 filas** de 3 perfiles activos:
  - "Administrador" (admin): 5 días, del 01/09 al 05/09. Es el caso de días propios de un admin (FB-ADJ-01) que el export no incluye.
  - "Humberto Dominguez" (supervisor): 11 días, del 01/09 al 11/09.
  - "Javier Alejandro Luna" (empleado): 7 días, del 06/09 al 12/09.
- **La app sigue funcionando:** Calendario, Equipo y Aprobaciones tienen que cargar sin error. Lo verifico revisando los errores de runtime de Vercel después de la purga. La carga visual con sesión de admin la confirma Luciano (no tengo credenciales de producción).

## 8. Acciones que tocaron producción en este paso

Solo las 4 consultas `SELECT` de §0 (método). Ninguna escritura.

---

## 9. Registro de ejecución

### Paso 1 — Snapshot ✅ (autorizado por Luciano, 2026-10-06)

- **Carpeta:** `~/Desktop/Dev/first-blades-backups/FB-PI-06-2026-10-06/`, fuera del repo y no commiteada.
- **Contenido:** `profile.json` · `auth_user.json` (desde la API de Auth Admin, **sin secretos**: no incluye `encrypted_password` ni tokens; incluye la identidad) · `rotation_assignments.json` (46) · `documents.json` (2) · `audit_log_referencias.json` (3) · `storage/03744042-…/` (los 2 archivos) · `manifest.json`.
- **Verificación:** los conteos dieron 1 perfil, 1 usuario, 1 identidad, 46 días, 2 documentos, 2 archivos y 3 entradas de auditoría, todos iguales a lo esperado. Los `sha256` de los archivos escritos en disco coinciden con lo descargado y los tamaños coinciden con `documents.file_size` (62 786 B y 38 365 B). El JSON de días releído tiene 46 filas.
  - certificado (PDF): `sha256` `3990de87a23a0e4e…`
  - estudio médico (DOCX): `sha256` `5642e5ffdd40b244…`
- **Producción:** solo lectura. Hubo `SELECT` de `profiles`, `rotation_assignments`, `documents` y `audit_log`, `getUserById` de Auth y 2 descargas de Storage. **Ninguna escritura.**

### Paso 2 — Archivos de Storage ✅ (autorizado por Luciano, 2026-10-06)

- **Pre-check (SQL, solo lectura):** bucket `documents` = 4 objetos; los 2 objetivo presentes; 2 objetos bajo el prefijo `03744042-…/`.
- **Ejecución:** `storage.from('documents').remove([…])` con la **API de Storage** (service role), solo con las 2 rutas exactas. La API devolvió los 2 objetos borrados. No se usó SQL sobre `storage.*`.
- **Post-check (SQL):** bucket `documents` = **2** · prefijo `03744042-…/` = **0** · `audit_log` = **19** (sin cambios).
- **Estado intermedio esperado:** las 2 filas de `documents` de Santiago siguen en la base, ya sin archivo, hasta el Paso 3. Los otros 2 documentos de la base tienen su archivo.
- **Producción:** **2 objetos borrados de Storage**, únicos cambios del paso.

### Paso 3 — Datos de la base ✅ (autorizado por Luciano, 2026-10-06)

Cada sub-paso en un bloque atómico que aborta si el conteo no es el esperado. Ninguno abortó.

| Sub-paso | Método | Pre-check | Resultado | Después |
|---|---|---|---|---|
| 3a `rotation_assignments` | SQL `DO $$ … $$` con guardas (además verifica id, email, estado y rol del perfil) | 46 filas | **46 borradas** | 0 de Santiago · total 69 → **23** |
| 3b `documents` | SQL `DO $$ … $$` con guardas (los 2 `id` identificados) | 2 filas | **2 borradas** | 0 de Santiago, 0 referencias por `uploaded_by`/`reviewed_by` · total 4 → **2** · 0 filas sin archivo |
| 3c usuario de Auth | **API de Auth Admin** `auth.admin.deleteUser(id, false)` (borrado duro), después de verificar que el email coincidía | perfil, usuario e identidad presentes; **0 dependencias** restantes en todas las tablas con FK | usuario borrado; `getUserById` ya no lo encuentra | cascada: `profiles` 28 → **27**, `auth.identities` del id → **0** |

`audit_log` en **19** antes y después de cada sub-paso.

### Paso 4 — Verificación posterior ✅

| Medida | Antes | Esperado | Después |
|---|---|---|---|
| `profiles` | 28 | 27 | **27** ✔ |
| `auth.users` | 28 | 27 | **27** ✔ |
| `rotation_assignments` | 69 | 23 | **23** ✔ |
| `documents` | 4 | 2 | **2** ✔ |
| Objetos del bucket `documents` | 4 | 2 | **2** ✔ |
| `audit_log` | 19 | 19 | **19** ✔ (las 3 entradas de §5 intactas; 0 con `actor_id` nulo) |
| `ausencia_requests` / `pasaje_requests` | 2 / 0 | sin cambios | **2 / 0** ✔ |
| Email en `profiles` / `auth.users` | 1 / 1 | 0 / 0 | **0 / 0** ✔ |
| Identidad en `auth.identities` | 1 | 0 | **0** ✔ |
| Objetos bajo el prefijo `03744042-…/` | 2 | 0 | **0** ✔ |
| Consistencia | — | — | 0 perfiles sin usuario de Auth · 0 documentos sin archivo ✔ |

**Remanente de calendario de prueba** (objeto del próximo trabajo, no de éste): **23 filas** de 3 perfiles activos.

| Perfil | Rol | Días | Rango | Estimados |
|---|---|---|---|---|
| Administrador | admin | 5 | 01/09 → 05/09 | 0 |
| Humberto Dominguez | supervisor | 11 | 01/09 → 11/09 | 3 |
| Javier Alejandro Luna | empleado | 7 | 06/09 → 12/09 | 0 |

Nota: de las **19 filas pasadas con `es_estimado = true`** que mencionaba el PRD (§7), **16 eran de Santiago**. Quedan 3, las del supervisor. El hallazgo sobre los crons (§4) sigue en pie.

**La app sigue funcionando:** los errores de runtime de Vercel para `first-blades-app` dan **0 errores** en las últimas 2 horas, una ventana que cubre toda la purga (la consulta de 7 días agotó el tiempo de espera). La carga visual de Calendario, Equipo y Aprobaciones con sesión de admin queda para que la confirme Luciano.

### Acciones que tocaron producción en toda la purga

1. Paso 0: 4 consultas de solo lectura.
2. Paso 1: solo lectura (consultas, `getUserById` y 2 descargas de Storage).
3. Paso 2: **2 objetos borrados** del bucket `documents` (API de Storage).
4. Paso 3a: **46 filas borradas** de `rotation_assignments` (SQL).
5. Paso 3b: **2 filas borradas** de `documents` (SQL).
6. Paso 3c: **1 usuario borrado** de Auth (API de Auth Admin), que en cascada borró **1 perfil** y **1 identidad**.
7. Paso 4: consultas de solo lectura y consulta de errores de runtime de Vercel.

`audit_log`: **sin cambios**. Snapshot para reconstruir: `~/Desktop/Dev/first-blades-backups/FB-PI-06-2026-10-06/`.
