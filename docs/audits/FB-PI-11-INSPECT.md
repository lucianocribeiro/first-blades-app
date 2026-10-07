# FB-PI-11-INSPECT — Inspección previa: import del calendario desde Excel (admin)

- **Fecha:** 2026-10-07
- **Rama:** `feat/fb-pi-11-import-calendario` (desde `origin/main` @ `d8f8f06`)
- **Prompt:** `docs/prompts/FB-PI-11.md` (Paso 0)
- **PRD:** `docs/prd-calendario-export-import.md`
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** lectura del repo (migraciones 0001–0021, export FB-PI-04, actions de calendario, helpers, tests) + **queries de solo lectura** a producción por MCP Supabase (ref `simfemdkrkdbumefcxei`): `information_schema`, `pg_constraint`, `pg_indexes`, `pg_policy`, `pg_enum`, `pg_proc`, `pg_roles` y `count(*)`. Más una medición local del tamaño del `.xlsx` con `buildCalendarioWorkbook` (probe temporal de Vitest, borrado; no quedó en el repo). **Sin escrituras en la base, sin migración, sin código de feature.**

---

## 0. Resumen

| Tema | Resultado |
|---|---|
| Reuso del export | Mapeo etiqueta↔enum **ya tiene inversas** (`excelLabelToEstado`, `excelLabelToMotivo`). Columnas, nombres de hoja, `getExportDays`, `validarRangoExport`, `MAX_DIAS_EXPORT` y el scope de empleados se reusan tal cual. |
| Esquema real | Coincide con el repo (0001 + 0009). `UNIQUE (user_id, fecha)` confirmado. Sin triggers. Enums exactos abajo. |
| Migración | Solo agrega **una función** (más, si Luciano lo aprueba, un índice; ver D3). Sin cambios de tabla ni de enum. |
| Volumen | **No hace falta lotear.** Una llamada a la Server Action + una sola RPC cubre 3 meses (≈2300 filas) y también un año (≈9150) con margen. Todo-o-nada por construcción. |
| Bloqueante | Ninguno. **Seis decisiones para Luciano** (§9) antes de escribir la migración. |

---

## 1. El export, pieza por pieza (lo que el import reusa)

Archivos: `lib/rotation/calendario-excel-mapping.ts`, `lib/rotation/calendario-excel.ts`, `lib/rotation/calendario-export.ts`, `app/(app)/calendario/export-actions.ts`.

### 1.1 Columnas (hoja `copy.calendario.excel.hojas.calendario` = `Calendario`)

`CALENDARIO_EXCEL_COLUMNS`, en este orden: `email` · `nombre` · `fecha` (bloqueadas) · `estado` · `motivo` · `motivo_otros` · `notas` (editables). Los encabezados salen de `copy.calendario.excel.columnas` y son **nombres técnicos** (`'email'`, `'fecha'`…): son la clave que lee el import. El import debe ubicar columnas **por encabezado**, no por posición, y fallar si falta alguna.

La segunda hoja (`Referencia`) se ignora en el import.

### 1.2 Mapeo etiqueta ↔ enum

Único, en `calendario-excel-mapping.ts`. Las etiquetas salen de `copy.status.*` (estado) y `copy.calendario.motivos.*` (motivo). **Las inversas ya existen** y fueron escritas para este PR:

- `excelLabelToEstado(label)` / `excelLabelToMotivo(label)`: comparación exacta tras `trim()`; lo que no matchea → `null` → error de validación.
- `ESTADO_CON_MOTIVO = 'periodo_fuera_trabajo'`, `MOTIVO_CON_DETALLE = 'otros'`.

Ya hay test de exhaustividad contra `Constants.public.Enums` (`tests/unit/calendario-excel-mapping.test.ts`). No se escribe una segunda versión de nada de esto.

### 1.3 Alcance de empleados

`fetchCalendarioExportData`: `profiles` con `status = 'activo'` y `role IN ('empleado','supervisor')`, vía `fetchAllRows`. **Admins excluidos** por decisión de producto (PRD §3). Ver D2 para qué hace el import con un email de admin o de un inactivo.

### 1.4 Formato de fecha

`fecha` se escribe como **texto** ISO `AAAA-MM-DD` con `numFmt = '@'`, para que vuelva intacta. Riesgo real: si alguien reescribe la celda, Excel o Sheets pueden convertirla a fecha nativa y `exceljs` la lee como `Date`. Ver D6.

### 1.5 Otros reutilizables

- `validarRangoExport` / `isValidIsoDate` / `MAX_DIAS_EXPORT = 366`: mismo tope y mismo validador de fecha para el import.
- `MOTIVO_OTROS_MAX = 80` (espejo de `VARCHAR(80)`).
- `getBusinessToday()` (`lib/business-date.ts`): fecha de negocio en AR, para `es_estimado`.
- `computeSaldoDiasTramite` + `TOPE_DIAS_TRAMITE_ANUAL = 3` (`lib/rotation/saldo-dias-tramite.ts`): el impacto en el saldo se calcula con esta misma función sobre el calendario "después del import", no con una fórmula nueva. Ojo: el saldo es **por año calendario**; un archivo que cruce el 31/12 necesita un saldo por año.

---

## 2. Esquema real de `rotation_assignments` (producción, catálogo)

| Columna | Tipo | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `user_id` | uuid | no | — (FK `profiles(id) ON DELETE CASCADE`) |
| `rotation_group_id` | uuid | sí | — (FK `rotation_groups ON DELETE SET NULL`) |
| `fecha` | date | no | — |
| `estado_dia` | `estado_dia` | no | `'trabajando'` |
| `motivo_ausencia` | `motivo_ausencia` | sí | — |
| `notas` | text | sí | — (sin límite de largo) |
| `created_at` / `updated_at` | timestamptz | no | `now()` (**sin trigger**: `updated_at` lo setea quien escribe) |
| `es_estimado` | bool | no | `false` |
| `motivo_otros_texto` | varchar(80) | sí | — |

- Constraints: `rotation_assignments_pkey`, **`rotation_assignments_user_id_fecha_key UNIQUE (user_id, fecha)`**, `rotation_assignments_motivo_requerido CHECK (estado_dia <> 'periodo_fuera_trabajo' OR motivo_ausencia IS NOT NULL)`, las dos FK.
- **No hay CHECK** que impida `motivo_ausencia` con un estado que no es `periodo_fuera_trabajo`, ni que ate `motivo_otros_texto` a `otros`. Esas reglas las hace cumplir la app; la RPC del import las tiene que validar ella misma (no se puede confiar en el CHECK).
- Triggers: ninguno. RLS: `rotation_assign_select` (SELECT) y `rotation_assign_write_admin` (ALL, admin).

### Enums (valores exactos, producción)

- `estado_dia`: `trabajando, en_viaje, en_franco, periodo_fuera_trabajo`
- `motivo_ausencia`: `vacaciones, licencia_medica, dia_tramite, matrimonio, fallecimiento, otros`
- `user_role`: `admin, supervisor, empleado`
- `employee_status`: `activo, inactivo` (`pendiente` retirado en 0021)
- `approval_status`: `pendiente, aprobado, rechazado`

El import **no agrega ni modifica enums**.

### Estado actual

`rotation_assignments = 0`, `ausencia_requests = 0`, `pasaje_requests = 0`, `profiles = 27` (24 empleados activos, 1 supervisor activo, 2 admins activos), `audit_log = 19`. `migration list` remota: 0001–0021, igual que local.

### ⚠️ Hallazgo: `profiles.email` no tiene UNIQUE

El PRD toma `email` como clave del import. En producción los 27 emails son distintos, ninguno es nulo y todos están en minúsculas, **pero ninguna constraint lo garantiza**: las únicas constraints de unicidad de `profiles` son `profiles_pkey` y `profiles_dni_unique`. Hoy la unicidad depende de `auth.users` + `handle_new_user`. Ver D3.

---

## 3. Patrón de las RPC existentes (molde §6.1)

Catálogo de producción, idéntico en `resolver_ausencia_request`, `resolver_pasaje_request`, `crear_aprobar_ausencia_admin`, `crear_aprobar_pasaje_admin` y `crear_procedimiento`:

- `owner = postgres`, `prosecdef = true`, `proconfig = {search_path=public}`.
- `proacl = {postgres=X, authenticated=X, service_role=X}`: sin `anon` ni PUBLIC.
- Guarda: `IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION '…' USING ERRCODE = '42501'`. El `IS NULL` explícito existe porque `is_admin()` devuelve NULL sin sesión.
- Grants al final del archivo: `REVOKE ALL … FROM PUBLIC; REVOKE ALL … FROM anon; GRANT EXECUTE … TO authenticated;` con la firma completa.
- Validaciones de negocio: `RAISE … USING ERRCODE = '22023'`.
- Upsert de calendario: `INSERT … ON CONFLICT (user_id, fecha) DO UPDATE SET …, updated_at = now() RETURNING id`.

El molde de la nueva función copia este esqueleto y suma un `SET search_path` idéntico (`public`).

## 4. `log_audit()`

```sql
public.log_audit(p_action TEXT, p_table_name TEXT, p_record_id UUID,
                 p_old_data JSONB DEFAULT NULL, p_new_data JSONB DEFAULT NULL) RETURNS void
-- SECURITY DEFINER, search_path=public, owner postgres
-- INSERT INTO audit_log (actor_id, …) VALUES (auth.uid(), …)
```

- `proacl = {postgres=X, service_role=X}`: cerrada a `anon`/`authenticated`/PUBLIC desde 0020. Una RPC `SECURITY DEFINER` owned por `postgres` la puede invocar igual.
- **Divergencia del repo, para dejar registrada:** 0013–0019 escriben auditoría con `INSERT INTO public.audit_log` directo. **Solo 0020** (`crear/actualizar/archivar_procedimiento`) usa `PERFORM public.log_audit(...)`. El prompt manda `PERFORM log_audit`, que alinea con el molde más nuevo (0020). No es un conflicto, pero las funciones viejas no sirven de ejemplo en este punto.
- `actor_id` lo toma `log_audit` de `auth.uid()`: no se pasa por parámetro.
- **`audit_log.record_id` es `UUID NOT NULL`.** La entrada de resumen de la importación no tiene una fila natural a la que apuntar. Ver D4.
- Convención por-día vigente (0016/0018): `action='…_calendario_sobrescrito'`, `table_name='rotation_assignments'`, `record_id` = id real de la fila, `old_data`/`new_data` = `{fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado}`. Las entradas por-día del import (solo días que pisan una solicitud aprobada) usan esa misma forma.

## 5. Cómo se suben archivos hoy

- Documentos y procedimientos: el cliente arma un `FormData`, lo manda a una Server Action (`handleDocumentUpload(formData)` en `app/(app)/mi-perfil/actions.ts`), se valida con `validateFile` / `MAX_FILE_SIZE_BYTES = 10 MB` (`lib/storage.ts`) y **se guarda en Storage**.
- **Para el import no corresponde guardar el archivo en Storage:** es un insumo de un solo uso y, si se guardara, haría falta bucket, policies y purga. Propuesta: reusar el patrón `FormData` → Server Action, parsear en memoria con `exceljs` (ya está en dependencias) y descartar el archivo. Validación: extensión `.xlsx`, MIME de OOXML y tamaño máximo.
- `next.config.ts` no toca `serverActions.bodySizeLimit`, así que rige el default de Next 15: **1 MB**.

## 6. Límites prácticos y loteo

### Tamaño del archivo (medido con `buildCalendarioWorkbook`)

| Caso | `.xlsx` | Generación | Parseo `exceljs` |
|---|---|---|---|
| 25 empleados × 92 días, vacío | 62 KB | 85 ms | 51 ms |
| 25 empleados × 92 días, completo | 67 KB | 64 ms | 30 ms |
| 25 empleados × 366 días, vacío | 216 KB | — | — |

→ Entra holgado en el límite de 1 MB de la Server Action, **sin tocar `bodySizeLimit`**. El tope del import queda en `MAX_DIAS_EXPORT` (366 días), igual que el export.

### Payload hacia Postgres

≈2300 filas × ~150 bytes ≈ 350 KB de JSONB para 3 meses, ≈1,4 MB para un año. PostgREST lo acepta sin configuración extra.

### Tiempo dentro de Postgres

`authenticated` y `authenticator` tienen **`statement_timeout = 8s`** y `lock_timeout = 8s`. Un `SET statement_timeout` dentro de la función no afecta al statement que ya está corriendo, así que la función tiene que entrar en esos 8 s. Propuesta: escritura **por conjunto**, no un loop por fila:

- `jsonb_to_recordset(p_filas)` → tabla temporal / CTE;
- un `INSERT … ON CONFLICT (user_id, fecha) DO UPDATE` para las filas a crear o modificar, y un `DELETE` para las celdas vacías;
- las entradas de auditoría por-día, solo para el subconjunto pisado (decenas, no miles).

Para 2300 filas esto es del orden de decenas de ms. Igual hay que medirlo en el test de volumen contra el Postgres local de CI, no darlo por sentado.

### ¿Lotear?

**No.** Una sola Server Action → una sola llamada `.rpc()` → una sola transacción. Si falla cualquier fila, guarda o auditoría, el statement entero se revierte. Eso cumple el "todo-o-nada" sin coordinar lotes. Lotear obligaría a una tabla de staging + commit final para mantener la atomicidad, y eso es complejidad sin necesidad con estos volúmenes. **Si en el futuro se necesitaran >366 días**, la respuesta es staging + commit único, nunca lotes con commit propio.

---

## 7. Interacciones con el resto del sistema (detectadas, a tener en cuenta)

1. **"Día que viene de una solicitud aprobada"**: `rotation_assignments` **no tiene FK ni columna** que diga de qué solicitud salió un día. Hay que derivarlo. El predicado ya existe en 0017: ausencia `estado='aprobado' AND post_aprobacion_tipo IS DISTINCT FROM 'cancelada' AND fecha BETWEEN fecha_inicio AND fecha_fin` (por `user_id`); pasaje, el mismo filtro con `fecha = ANY(dias_viaje)` (por `empleado_id`). Ver D5 para la definición exacta de "pisar".
2. **Cancelar después de importar borra días importados.** `cancelar_editar_ausencia_aprobada` (0018) borra **todas** las filas `periodo_fuera_trabajo` del rango de la solicitud, sin mirar quién las escribió. Si el import pinta un día cubierto por una ausencia aprobada con otro motivo (ej. licencia en lugar de vacaciones) y después se cancela esa ausencia, el día importado se borra. Es el mismo comportamiento que hoy tiene una repintada a mano: no lo introduce el import y queda fuera de alcance. **Se avisa en la previsualización**, en el bloque de días pisados.
3. **Edición manual sin auditoría:** `upsertRotationAssignment` / `upsertRotationRange` escriben con upsert directo y **no** registran en `audit_log`. El import va a quedar mejor auditado que la edición manual. No se toca; queda registrado.
4. **`notas`:** el export la incluye, pero ninguna acción de la app la escribe hoy. El import pasa a ser el único escritor de `notas` además de la base. Sin conflicto.
5. **`es_estimado` de días pasados todavía en `true`** (PRD §7, FB-PI-08/10): si el import reescribiera filas sin cambios, el test de ida y vuelta fallaría por ese flag. Ver regla "sin cambios = no se toca" en D1.
6. **Concurrencia previsualización → confirmación:** entre que el admin ve la previsualización y confirma, alguien puede aprobar una solicitud o editar una celda. Si la escritura solo recibe "las filas del archivo", el admin estaría confirmando un impacto que ya no es el real. Ver D1.

---

## 8. Tests e infraestructura existentes

- Integración contra Postgres local (`TEST_DATABASE_URL`, Supabase local en CI). Ahí van el drift detector (`tests/integration/migration.test.ts`, 1270 líneas, con tests de catálogo por función: firma, `prosecdef`, `search_path`, owner y grants a `authenticated` sin `anon`/PUBLIC; se replica ese bloque para la función nueva), el test de volumen y el de ida y vuelta.
- Precedentes para copiar: `tests/integration/calendario-export.test.ts`, `procedimientos-rpc.test.ts` (RPC con `log_audit`), `tests/unit/role-limits.test.ts`, `tests/e2e/calendario-export.spec.ts`.
- e2e: los specs actuales se mantienen; se suma un spec de import (subir → previsualizar → bloqueo con errores → confirmar).

---

## 9. Decisiones para Luciano antes de la migración ⛔

Cada una con recomendación. Ninguna re-abre lo ya decidido (pisar solicitudes, modelo híbrido de `audit_log`, celda vacía = borrar).

**D1 — Qué escribe la RPC y cómo se protege de la concurrencia.**
Recomendación: la RPC recibe el lote **completo y ya validado** (filas `{user_id, fecha, estado, motivo, motivo_otros, notas}`) y **recalcula ella misma**, dentro de la transacción y con `SELECT … FOR UPDATE` del rango, qué filas crea, modifica, borra y cuáles pisan una solicitud. Así la auditoría no depende de lo que diga el cliente. Además recibe los conteos que el admin vio en la previsualización (`creadas`, `modificadas`, `borradas`, `pisadas`) y **aborta si no coinciden**: el calendario cambió y hay que volver a previsualizar. Reglas:
- **Sin cambios = no se toca la fila** (ni `updated_at` ni `es_estimado`). Garantiza el cero-diferencias del test de ida y vuelta.
- Comparación de "cambio" sobre `estado_dia`, `motivo_ausencia`, `motivo_otros_texto` y `notas`, normalizando vacío a NULL.
- `es_estimado` en filas creadas o modificadas: `false` si `fecha <= hoy (AR)`, `true` si es futura. Es el mismo criterio que `upsertRotationRange`. El prompt solo fija el caso pasado; confirmar el futuro.

**D2 — Email que existe pero está fuera del alcance del export** (admin o empleado inactivo).
Recomendación: **error de validación**, igual que un email inexistente. Coherente con PRD §3: los días de un admin no se corrigen por Excel, y un inactivo no aparece en el archivo.

**D3 — Unicidad de `profiles.email`.**
Opción A (recomendada): sumar a esta migración `CREATE UNIQUE INDEX profiles_email_lower_unique ON profiles (lower(email))`. Hoy no rompe nada (27/27 distintos y en minúsculas), y convierte en garantía de base lo que el import asume. Opción B: sin índice; el import trata un email con más de un match como error. Matching siempre con `trim` + minúsculas.

**D4 — `record_id` de la entrada de resumen** (`audit_log.record_id` es `NOT NULL`).
Recomendación: la RPC genera un `import_id := gen_random_uuid()` y lo usa como `record_id`, con `action = 'calendario_importado'` y `table_name = 'rotation_assignments'`. `new_data = {import_id, desde, hasta, creadas, modificadas, borradas, pisadas}`. Las entradas por-día (`action = 'importacion_calendario_sobrescrito'`, forma de 0018) llevan `import_id` en `new_data` para vincularlas al resumen. La RPC devuelve el `import_id`.

**D5 — Qué cuenta como "pisar" un día de solicitud aprobada.**
Recomendación: el día está cubierto por una solicitud aprobada no cancelada (predicado de 0017, §7.1) **y** el import lo **modifica o lo borra**. Si el import deja ese día igual, no lo pisa: no se lista ni se audita por día.

**D6 — Rango y forma de las filas.**
Recomendaciones:
- El rango del import es `min(fecha)..max(fecha)` del archivo, con el mismo tope de 366 días (`validarRangoExport`), y además dentro de una ventana razonable: fechas entre `2020-01-01` y hoy + 2 años. **Solo se tocan los `(email, fecha)` presentes en el archivo**: una fila ausente no se borra.
- `(email, fecha)` duplicado en el archivo → error en ambas filas.
- `notas` o `motivo` con estado vacío → error. Si no, "borrar el día" y "dejar una nota" se contradicen.
- `fecha` que llega como `Date` nativa (Excel o Sheets la reconvirtieron) → se acepta, normalizada a `AAAA-MM-DD` en UTC. Si no se puede interpretar, es error.
- `motivo` con estado distinto de "Fuera del trabajo" → error. `motivo_otros` con motivo distinto de "Otros" → error. Las dos reglas valen también dentro de la RPC (§2: la base no tiene CHECK para esto).
- `motivo_otros` > 80 caracteres → error, sin truncar.

---

## 10. Próximo paso

Con D1–D6 resueltas: migración `0022_import_calendario.sql` (función `importar_calendario`, más el índice de D3 si se aprueba) con delta-only sobre el esquema relevado acá, auditoría de esquema previa al push y drift detector actualizado. **No se escribió migración ni código de feature en este paso.**
