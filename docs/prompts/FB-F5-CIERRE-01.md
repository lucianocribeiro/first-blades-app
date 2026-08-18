# FB-F5-CIERRE-01 — Bump de la Constitución a v0.8

- **ID:** FB-F5-CIERRE-01
- **Tipo:** cierre de fase, doc-only
- **Destino:** Claude Code
- **Fuente de verdad:** `docs/constitucion.md` (hoy v0.7.1)

---

## Objetivo

Llevar `docs/constitucion.md` de **v0.7.1 a v0.8**, incorporando todo lo que cambió en Fase 5 y en el ajuste `FB-ADJ-03`.

La constitución es la fuente de verdad viva que lee el chat Developer de cada fase. Si queda desactualizada, la próxima fase arranca con supuestos falsos.

**Doc-only.** No toca código, esquema ni tests.

## Método

**Leé el archivo real antes de editar.** Los deltas de abajo son la lista de lo que cambió, no el texto a copiar: ubicá cada uno en la sección que corresponda según cómo esté organizado el documento hoy. Si algún delta ya está reflejado (por ejemplo la corrección factual de `employee_status`, que entró con `FB-ADJ-03`), **no lo dupliques**.

Si encontrás algo desactualizado que no está en esta lista, **reportalo** y sumalo.

---

## Deltas a incorporar

### Esquema y datos

- **`procedures`** dejó de ser inerte: columnas en español (`titulo`, `contenido_texto`, `file_path`, `categoria`), enum `procedure_estado` {`vigente`, `archivado`}, columna `estado NOT NULL DEFAULT 'vigente'`, y CHECK `procedures_contenido_presente` que exige al menos uno de texto o archivo, tratando whitespace como ausente (`!~ '^[[:space:]]*$'`).
- **RLS de `procedures`:** no-admin solo ve `vigente`; admin ve todo.
- **Tres RPCs `SECURITY DEFINER`:** `crear_procedimiento`, `actualizar_procedimiento`, `archivar_procedimiento`. Escriben `procedures` + `audit_log` en una transacción, con guarda `is_admin()` interna.
- **`log_audit()` cerrada:** se le revocó `EXECUTE` a `anon`, `authenticated` y `PUBLIC`. Queda como helper interno invocable por `PERFORM` desde funciones `SECURITY DEFINER`. **Antes de esto, cualquier usuario autenticado podía escribir entradas falsas en `audit_log` vía REST.**
- **Bucket `procedimientos`:** privado, escritura solo admin, lectura para autenticados, MIME limitado a PDF / Word / texto. Path sin `{userId}` — los procedimientos no tienen dueño.
- **`profiles`:** `motivo_baja` (text, nullable) y `fecha_baja` (date, nullable). Nullable en la base, **obligatorias en la aplicación al inactivar**.
- **`employee_status`** quedó con dos valores: `activo`, `inactivo`. Migración `0021`.
- **Migraciones en producción: 0001–0021.**

### Producto y módulos

- **Módulo Procedimientos / Políticas** en producción: una pantalla para los tres roles, con acciones de edición y archivado visibles solo para el admin. Búsqueda por título y categoría (`ilike` server-side, sin `pg_trgm`). Categoría de texto libre con sugerencias. Contenido **archivo o texto, excluyente por decisión de la aplicación** — la base acepta ambos. Texto en Markdown, sanitizado server-side (`marked` + `sanitize-html`). Badge "Nuevo" 7 días desde `updated_at`, igual para todos, sin acuse de lectura. Publicación directa del admin, sin purgatorio.
- **Módulo "Ingreso": eliminado.** El cliente lo descartó. No es "próximamente": no existe.
- **Gestión de Usuarios:** el admin resetea contraseñas de usuarios existentes (la tipea, igual que en el alta); la baja exige motivo y fecha.

### Seguridad y acceso

- **Gate de acceso: solo `activo` entra.** Verificado en `requireAuth()`, server-side. `inactivo` queda afuera; una sesión abierta se corta en el siguiente request. **`signOut()` antes del redirect** para evitar el loop entre `requireAuth` y el middleware.
- **Mensajes indistinguibles:** un usuario que autentica bien pero no está `activo` ve el mismo mensaje que una credencial inválida. La expiración legítima de sesión (sin sesión válida) conserva su copy neutro, porque no filtra nada.
- **El alta setea `activo` explícitamente**, sin depender del default.
- **Validación de contraseña:** mínimo 8 caracteres, al menos un número y una mayúscula. Helper único compartido por alta y reseteo, validado server-side.
- **Excepción al uso del admin client:** el reseteo de contraseña lo requiere por naturaleza (Supabase Auth), y solo se alcanza **después** de verificar admin por sesión con `createServerClient()`. La escritura en `audit_log` de esas operaciones también usa el admin client, con `actor_id` tomado de la sesión verificada — usar `service_role` dejaría el autor en NULL.

### Patrones de código

- **Excepción al contrato return-based (§2.5):** los guards de rol pueden cortar por `redirect`. El contrato `{ ok }` aplica a los errores esperados de una llamada autorizada; `redirect()` no sufre la redacción de Next en producción.
- **Errores de PostgREST como valor:** un `try/catch` **no** captura el `{ error }` que devuelve un `.insert()` fallido. Hay que leerlo explícitamente. Aplica a toda escritura no bloqueante, como la auditoría.
- **Hardening de operaciones sobre otros usuarios:** revalidar el perfil objetivo server-side después del guard de rol, tratar cero filas afectadas como error, y **bloquear la auto-inactivación del admin** (si es el único, la app queda sin acceso recuperable).

### Proceso (cambio aprobado por Luciano)

- **Dos niveles de rigor.** Migraciones: ceremonia completa — inspección, auditoría, re-auditoría si hay hallazgos, merge, runbook gateado, verificación de catálogo, regen de tipos. **Piezas de interfaz y features:** auditoría de Codex sí, pero el Developer triagea los hallazgos; se arregla lo bloqueante antes del merge y el resto va al Log; **sin re-auditoría** salvo que haya algo bloqueante.
- **Versionado del informe verbatim:** obligatorio antes del merge en migraciones; en features se versiona junto al merge.
- **Pedir los informes de Codex dentro de un bloque de código**, para que el Markdown no se aplane en el traslado y el verbatim sea fiel.
- **Todo prompt que arranque con inspección debe pedir su informe versionado explícito.** Embeberla en el prompt deja el relevamiento solo en el chat.
- **La autorización de merge es de Luciano, sin excepción**, incluidos los PRs doc-only o de archivos generados.
- **El regen de `types.ts` se aplica siempre**, aunque el diff sea de infraestructura (por ejemplo `PostgrestVersion`) y no del esquema. El diff cero solo sirve como señal si se mantiene en cero.

---

## Definition of Done

- [ ] Rama `docs/constitucion-v0-8` desde `origin/main` actualizado.
- [ ] `docs/constitucion.md` en **v0.8**, con todos los deltas ubicados donde corresponda, sin duplicar lo ya reflejado.
- [ ] Registro de versión actualizado, si el documento lleva uno.
- [ ] `CLAUDE.md` coherente con la constitución nueva.
- [ ] `docs/prompts/FB-F5-CIERRE-01.md` versionado.
- [ ] `commit → push`, CI en verde.
- [ ] PR abierta, **sin mergear**.
- [ ] Reporte: rama, PR, CI, un resumen de qué secciones tocaste, y **cualquier cosa desactualizada que hayas encontrado y no esté en esta lista**.

## Si algo se desvía

Si algún delta contradice lo que dice hoy la constitución, o si el documento tiene una estructura que no admite alguno de estos puntos donde lo esperás, **reportalo antes de forzarlo**.
