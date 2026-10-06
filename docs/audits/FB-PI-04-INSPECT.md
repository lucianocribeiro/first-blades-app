# FB-PI-04-INSPECT — Inspección previa: export del calendario a Excel (admin)

- **Fecha:** 2026-10-06
- **Rama:** `feat/fb-pi-04-export-calendario` (desde `main` @ `7c23982`)
- **Prompt:** `docs/prompts/FB-PI-04.md` (Paso 0)
- **PRD:** `docs/prd-calendario-export-import.md`
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** lectura de archivos del repo (migraciones, `supabase/types.ts`, `supabase/config.toml`, código de la app y tests) + `npm view` del registro público. Sin queries a la base de producción, sin escrituras, sin código de feature al momento de escribir este informe.

---

## 1. Librería de Excel

**No hay ninguna en el repo** (`package.json` no tiene `exceljs`, `xlsx` ni similar; `node_modules` tampoco).

**Propuesta: `exceljs` 4.4.0** (MIT, Node puro, sin binarios nativos).

| Requisito | `exceljs` | `xlsx` (SheetJS CE) |
|---|---|---|
| Escribir `.xlsx` | ✓ | ✓ |
| Validación de datos (desplegables) | ✓ `worksheet.dataValidations.add(rango, {type:'list'})` | ✗ — la escritura de validaciones es de la edición Pro |
| Bloqueo de celdas + protección de hoja | ✓ `cell.protection.locked` + `worksheet.protect()` | ✗ en CE (solo estilos Pro) |
| Leer `.xlsx` (lo necesita FB-PI-05) | ✓ | ✓ |

SheetJS queda descartada por el requisito duro (desplegables + bloqueo). `exceljs` se usa **solo del lado del servidor** (Server Action); no entra al bundle del cliente. Mismo paquete servirá para leer el archivo en el import (FB-PI-05), sin sumar otra dependencia.

## 2. Módulo Calendario

- Ruta: `app/(app)/calendario/page.tsx` — **compartida por los 3 roles** (no hay ruta admin aparte). `requireAuth()` + `createServerClient()`; `isAdmin` decide si la grilla es interactiva. Las acciones de escritura (`actions.ts`) son las que llevan `requireAdmin()`.
- Consulta de empleados (scope admin):
  ```ts
  supabase.from('profiles').select('id, full_name, email')
    .eq('status', 'activo')
    .in('role', ['empleado', 'supervisor'])
    .order('full_name', { ascending: true })
  ```
- Consulta de `rotation_assignments`: `.select('*').in('user_id', ids).gte('fecha', desde).lte('fecha', hasta)`.
- Helpers reutilizables: `getDateRange(a, b)` en `calendario/utils.ts` (fechas ISO inclusive, aritmética UTC), `validateAssignmentInput`, `getBusinessToday()` (`lib/rotation/promote-estimated.ts`), `MOTIVO_OPTIONS` (`lib/rotation/motivo-options.ts`, enum → copy para `<Select>`).

**Decisión de alcance de "empleado activo":** el export usa **el mismo scope que el roster del admin** (`status = 'activo'` y `role ∈ {empleado, supervisor}`). Los admins no aparecen en el roster de la app, así que tampoco en el archivo. Se reporta por si Luciano espera que los admins (que tienen calendario por admin-para-sí, FB-ADJ-01) también estén; cambiarlo es una línea.

### ⚠️ Hallazgo: tope de 1000 filas de PostgREST

`supabase/config.toml` → `max_rows = 1000` (el default de Supabase hosted también es 1000). Un export de 3 meses × 27 empleados puede traer hasta ~2500 filas de `rotation_assignments`: **una sola query se truncaría en silencio** y el archivo saldría con días "vacíos" que en realidad tienen asignación. El export **pagina con `.range()`** ordenado por una clave estable (`user_id, fecha`) hasta agotar los datos.

Lateral, fuera de alcance: la página de Calendario hace una sola query por mes (27 × 31 ≈ 840 filas hoy). Con ~33+ empleados activos empezaría a truncar. No se toca acá; se reporta.

## 3. Guard de admin

`lib/auth.ts`:

- `requireAuth()` → `redirect('/login')` sin sesión o sin perfil; si `status !== 'activo'`, `signOut()` + `redirect('/login?motivo=acceso')`.
- `requireRole(role)` → `redirect('/dashboard')` si el rol no coincide.
- `requireAdmin()` = `requireRole('admin')`.

Corta por `redirect()` (excepción FB-F5-AUD-05 al contrato return-based, §2.5). La Server Action del export llama a `requireAdmin()` **antes** de crear el cliente o consultar nada. Los tests unitarios existentes simulan el corte con `requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'))` y verifican que la consulta nunca se dispara — mismo molde.

## 4. `/lib/copy`

Un único objeto `copy` en `lib/copy/index.ts` (`as const`), con una sección por módulo. Relevante:

- `copy.calendario.*` — título, modal, `motivos.{vacaciones, licencia_medica, dia_tramite, matrimonio, fallecimiento, otros}`, errores.
- `copy.status.{trabajando, en_viaje, en_franco, periodo_fuera_trabajo}` — etiqueta de la app para `periodo_fuera_trabajo` es **"Fuera del trabajo"**.

Las etiquetas del Excel van en una subsección nueva **`copy.calendario.excel`** (encabezados, nombres de hoja, etiquetas de estado/motivo, mensajes de error, UI del panel). Para el estado se usa **"Período fuera del trabajo"** tal como lo fijan el PRD y el prompt (difiere de la etiqueta corta de la grilla; es deliberado: en el archivo no hay leyenda que lo explique). Las etiquetas de motivo reusan `copy.calendario.motivos` — coinciden 1:1 con el PRD.

## 5. Enums reales (del esquema, no de la constitución)

Fuente: `supabase/migrations/0001_init.sql:13-14` y `supabase/types.ts` (`Constants.public.Enums`, regenerado contra prod):

- `estado_dia`: `trabajando`, `en_viaje`, `en_franco`, `periodo_fuera_trabajo`
- `motivo_ausencia`: `vacaciones`, `licencia_medica`, `dia_tramite`, `matrimonio`, `fallecimiento`, `otros`

Coinciden con el PRD. Columnas reales de `rotation_assignments` relevantes: `user_id`, `fecha`, `estado_dia`, `motivo_ausencia`, `motivo_otros_texto` (`VARCHAR(80)`), `notas`, `es_estimado`. Restricciones: `UNIQUE(user_id, fecha)`; CHECK `rotation_assignments_motivo_requerido` (`periodo_fuera_trabajo` ⇒ motivo no nulo).

`supabase/types.ts` exporta `Constants.public.Enums.*` **en runtime**: el test de exhaustividad del mapeo compara contra esas listas, así que un valor nuevo del enum (tras regenerar tipos) hace fallar el test. Además el mapeo se tipa como `Record<EstadoDia, string>` / `Record<MotivoAusencia, string>`, que hace fallar el typecheck.

Notas para FB-PI-05 (no se actúa acá): `motivo_otros_texto` tiene tope de 80 caracteres en la base; `es_estimado` no es columna del archivo.

## 6. Descarga de archivos

**No hay patrón existente para servir un archivo generado.** Lo que existe:

- `app/api/cron/*/route.ts`: Route Handlers con `NextResponse.json`, autenticados por `CRON_SECRET` (no sesión).
- Documentos y procedimientos: signed URLs de Storage (archivos ya subidos, no generados).

**Propuesta:** Server Action `exportarCalendarioExcel({ desde, hasta })` que devuelve, por contrato return-based (§2.5), `{ ok: true, filename, base64 } | { ok: false, error }`. El cliente arma un `Blob` y dispara la descarga con un `<a download>`. Razones frente a un Route Handler:

- El guard (`requireAdmin()` → `redirect()`) y el error de negocio (`{ ok:false, error }` con copy es-AR) siguen exactamente los contratos de §2.5, sin inventar uno nuevo para Route Handlers (que no pueden devolver un mensaje es-AR a la pantalla sin redirigir).
- Tamaño acotado: rango máximo de 366 días; 27 × 92 días ≈ 2500 filas → decenas de KB.

Nombre de archivo: `calendario_AAAA-MM-DD_a_AAAA-MM-DD.xlsx`.

## 7. Tests y CI

- Unit (`tests/unit`, Vitest + jsdom): molde de `calendario-range-action.test.ts` (mock de `@/lib/auth` y `@/lib/supabase/server`).
- Integración (`tests/integration`, Supabase local): no hace falta para el export (no hay RLS nueva; la de `rotation_assignments`/`profiles` ya está cubierta en `rls.test.ts`).
- e2e: **31 tests** hoy en 10 specs; tercer job de CI con Supabase local efímero sembrado por `seed:e2e`.

## 8. Migración

**Ninguna.** El export es solo lectura con el cliente de sesión (RLS de admin ya permite SELECT de `profiles` y `rotation_assignments`).

---

## 9. Verificación en Google Sheets — **PENDIENTE (no verificado)**

Se intentó verificar subiendo un archivo de muestra con datos **sintéticos** a Google Drive (con conversión a Sheets). La subida fue **bloqueada por el control de permisos de la sesión** de Claude Code (escritura en una app conectada no pedida explícitamente). No se reintentó por otra vía.

**Estado: no verificado en ninguna dirección.** Lo que sí está verificado sobre el `.xlsx` generado (XML crudo + relectura con `exceljs`, ver tests):

- `<dataValidation type="list" … sqref="D2:D…">` (estado) y `sqref="E2:E…">` (motivo) con lista inline `"A,B,C"`, `allowBlank="1"`, `showErrorMessage="1"`; `motivo_otros` con `textLength ≤ 80`.
- `<sheetProtection sheet="1" …>` sin contraseña; columnas `email`/`nombre`/`fecha` bloqueadas (default OOXML), `estado`/`motivo`/`motivo_otros`/`notas` con `locked="0"`.

**Para cerrarlo (Luciano):** exportar un rango corto desde la app (o usar la muestra sintética que deja la sesión), subirlo a Drive → *Abrir con Google Sheets*, y revisar: (1) ¿aparece el desplegable en `estado` y `motivo`? (2) ¿rechaza un valor fuera de la lista? (3) ¿quedan protegidas `email`/`nombre`/`fecha`? El resultado se anota acá.

---

## 10. Ajustes posteriores (FB-PI-04-B)

- **§4 queda superado:** la etiqueta de `periodo_fuera_trabajo` en el Excel se unificó a **"Fuera del trabajo"**, la misma de la grilla. Las cuatro etiquetas de estado salen de `copy.status` y las de motivo de `copy.calendario.motivos`: **una sola fuente**, consumida por el mapeo. Se eliminó `copy.calendario.excel.estados`, que duplicaba los cuatro literales y tenía uno divergente. Los textos del archivo que nombran el estado (mensaje de error del motivo y nota de Referencia) componen la etiqueta desde `copy.status`.
- **Revisión de las demás etiquetas:** los otros tres estados (Trabajando, En franco, En viaje) y los seis motivos **ya coincidían** con la app. La única divergencia era la de `periodo_fuera_trabajo`.
- **§2, alcance de empleados:** se confirmó como decisión de producto y quedó documentado en el PRD §3 y en `fetchCalendarioExportData`. El subtítulo del panel decía "todos los empleados activos" y se corrigió a "los empleados y supervisores activos".
