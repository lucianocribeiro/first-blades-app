# FB-F5-01-INSPECT — Inspección de solo-lectura previa a Fase 5

- **ID:** FB-F5-01-INSPECT
- **Fase:** 5 — Procedimientos / Políticas + arreglos de Gestión de Usuarios
- **Destino:** Claude Code
- **Tipo:** solo-lectura (no escribe código de feature, no toca el esquema, no escribe en la base)
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1) en el repo

---

## Objetivo

Levantar el estado **real** del repo y de producción en todo lo que Fase 5 va a tocar, **antes** de escribir una sola línea de migración o de feature. La regla es delta-only: no se diseña nada sobre supuestos. La salida de este prompt es un informe versionado que alimenta los prompts de build.

## Alcance

**Sí:** consultas de solo-lectura a producción vía MCP de Supabase, lectura de archivos del repo, y la redacción del informe.

**No:** ninguna migración, ningún `db push`, ninguna escritura en la base (ni de prueba), ningún cambio de código de feature, ningún `types.ts` regenerado. Si algo de lo que se pide requiere escribir, **no lo hagas** y anotalo como bloqueante en el informe.

## Contexto — decisiones ya cerradas con Luciano

Fase 5 tiene dos partes:

**Parte 1 — Procedimientos / Políticas.** El admin publica directo (sin purgatorio ni bandeja Aprobaciones), queda registrado en `audit_log`. Supervisor y Empleado solo leen. Contenido = archivo (PDF / Word / `.txt`) y/o texto escrito en la app; al menos una de las dos formas.

- Categoría: **texto libre** con sugerencias de las categorías ya usadas.
- Archivar: el archivado **desaparece para no-admin**, el admin lo sigue viendo con etiqueta y lo puede reactivar. No se borra.
- Aviso in-app: badge **"Nuevo" por 7 días**, derivado de la fecha de publicación/actualización, **igual para todos**. Sin acuse de lectura, sin estado por usuario, sin tabla nueva.
- Sin versionado ni historial: el reemplazo es en el lugar.

**Parte 2 — Gestión de Usuarios.**

- **Reseteo de contraseña:** el admin **tipea** la nueva contraseña de un usuario existente, igual que en el alta. Admin-only verificado server-side, auditado.
- **Baja con motivo y fecha:** al pasar un usuario a inactivo, motivo (texto libre) y fecha (la elige el admin, hoy por defecto) son **obligatorios**.
- No hay usuarios inactivos reales hoy (solo usuarios de prueba a purgar aparte). No hace falta backfill.

---

## Qué inspeccionar

Ordenado por criticidad. Para cada bloque, reportá lo que **hay**, no lo que debería haber.

### A. Tabla `procedures` en producción (bloque más importante)

Existe pero está inerte. Necesito su forma exacta:

1. Columnas: nombre, tipo, nullabilidad, default.
2. Constraints: PK, FK, UNIQUE, CHECK (transcribí la definición completa).
3. Índices existentes.
4. ¿RLS habilitada? Políticas existentes: nombre, comando, rol, `USING` / `WITH CHECK` transcriptos.
5. Triggers (en particular si hay algo tipo `set_updated_at`).
6. **Conteo de filas** y, si hay filas, qué son.
7. Grants sobre la tabla.

### B. Patrón de archivos (el molde a reusar)

1. Buckets de Storage existentes: nombre, `public` true/false, límites configurados a nivel bucket (tamaño, MIME).
2. Políticas de `storage.objects`: transcriptas, con la lógica de path que usan.
3. `lib/storage.ts`: firma y comportamiento real de `validateDocumentFile`, `createSignedUrl`, `uploadDocument` — **whitelist de MIME actual**, límite de tamaño actual, forma del path (`{profile_id}/...` o lo que sea), y cómo aplican el contrato return-based (§2.5).
4. Componente/flujo de subida en la UI de documentos: qué se reusa tal cual y qué está acoplado a `documents`.
5. ¿El trigger `storage.protect_delete()` sigue presente y qué implica para los tests de este módulo?

### C. `audit_log` — cómo se escribe hoy (bloque crítico para el diseño)

El PRD pide que la publicación de un procedimiento quede en `audit_log`, y la publicación es una escritura simple del admin, no una transición por RPC.

1. Forma real de la tabla: columnas, tipos, cuáles son NOT NULL.
2. Políticas RLS: confirmá si existe o no una policy de `INSERT` para `authenticated` / admin.
3. **Todos** los caminos por los que hoy se escribe en `audit_log`: listá cada uno (RPC `SECURITY DEFINER`, admin client, trigger) con archivo y línea.
4. **Conclusión explícita:** con la RLS actual, ¿un admin logueado vía `createServerClient()` puede insertar en `audit_log` directamente? Si **no** puede, decilo claro y listá las opciones que ves (nueva policy de INSERT acotada a admin, RPC `SECURITY DEFINER` chica, trigger en `procedures`), con el pro y el contra de cada una. **No implementes ninguna.** La decisión la tomo yo en el prompt de build.

### D. `profiles` y el flujo de inactivación

1. Confirmá que `motivo_baja` y `fecha_baja` **no** existen. Si existen, reportá su forma exacta.
2. Columna de estado: nombre real, enum, valores, default.
3. Dónde vive hoy la acción de cambiar el estado de un usuario: archivo, nombre de la action, forma del formulario, si usa el contrato return-based.
4. ¿Hay alguna validación o efecto secundario al inactivar (sesiones, RLS que dependa del estado, filtros de listados)? Importa: si un inactivo sigue pudiendo loguearse, quiero saberlo ahora.

### E. Alta de usuario y Supabase Auth admin (molde del reseteo)

1. Dónde y cómo se crea un usuario hoy: archivo, action, uso de `createAdminClient()` / admin client de Auth, y **exactamente cómo se verifica server-side que quien llama es admin** antes de llegar al admin client.
2. Reglas de contraseña vigentes (largo mínimo, validación en cliente y/o server).
3. ¿Existe ya algún helper de "guarda de admin" reutilizable, o la verificación está inline en cada action?
4. Reportá si la creación de usuario queda registrada en `audit_log` hoy, y cómo.

### F. Menú, rutas y sistema de diseño

1. Ítem "Procedimientos" en el shell: ¿existe?, ¿en qué ruta?, ¿es placeholder?, ¿qué roles lo ven?
2. Componentes del sistema de diseño ya disponibles y reusables para este módulo: tabla, badge de estado, modal de previsualización, input de búsqueda, textarea. Listá los que hay con su ruta.
3. `/lib/copy`: estructura y convención para agregar el copy de un módulo nuevo.
4. ¿Hay algún patrón de **búsqueda** ya implementado en el repo (filtro client-side, `ilike`, etc.)? Si lo hay, dónde.

### G. Base de datos: contexto para la migración

1. Última migración aplicada y el número que corresponde a la próxima.
2. `migration list`: confirmá Local = Remote.
3. Extensiones instaladas (interesa `pg_trgm` para búsqueda, `btree_gist` ya está).
4. Convención real del drift detector en `migration.test.ts`: qué inventaría y qué hay que agregarle cuando aparecen columnas o tablas nuevas.

### H. Estado del repo

1. `git status`: rama actual, limpieza del working tree, ramas locales y remotas, PRs abiertos.
2. Drift entre `main` local y `origin/main`.
3. Confirmá que `docs/pdr-fase-4.md` sigue untracked y **no lo toques**.
4. Estado de los 3 jobs de CI en `main`.

---

## Entregable

Un informe en **`docs/prompts/FB-F5-01-INSPECT-REPORT.md`**, en es-AR, con una sección por cada bloque A–H, en ese orden.

Reglas del informe:

- **SQL y definiciones transcriptas literalmente** donde se pidió (políticas, constraints, firmas). Nada de resúmenes en prosa cuando se pidió la definición.
- Archivo y línea en cada referencia a código.
- Marcá con **⚠️** cualquier cosa que contradiga el PRD de Fase 5, el traspaso técnico o la Constitución v0.7.1. Especialmente: la conclusión del bloque C, y cualquier campo de `procedures` que ya exista con una forma distinta a la esperada.
- Si algo no se pudo verificar, decí **por qué** y qué haría falta. No lo dejes en blanco ni lo infieras.
- Cerrá con una sección **"Riesgos y decisiones que le quedan al Developer"**: lista corta de lo que hay que resolver antes del build, sin proponer implementación.

## Definition of Done

- [ ] Rama `fase-5/f5-01-inspect` creada desde `origin/main` actualizado.
- [ ] `docs/prompts/FB-F5-01-INSPECT.md` versionado (este mismo archivo).
- [ ] `docs/prompts/FB-F5-01-INSPECT-REPORT.md` creado y completo, bloques A–H.
- [ ] Ninguna escritura en la base, ninguna migración, ningún cambio de código de feature, ningún `types.ts` tocado. Confirmalo explícitamente en el informe.
- [ ] `commit → push` y **CI en verde** en la rama.
- [ ] PR abierta contra `main`, **sin mergear**. El merge lo autoriza Luciano en un prompt aparte.
- [ ] Reportá al cierre: rama, PR (número, estado, CI), y un resumen de 5 líneas con los hallazgos que más impactan el diseño.

## Si algo se desvía

Si durante la inspección aparece algo que cambia el alcance o el proceso (por ejemplo, que `procedures` tenga datos, o que la RLS de `audit_log` obligue a una pieza que no estaba prevista), **flagueálo explícitamente en el informe y frená**. No lo resuelvas por tu cuenta.
