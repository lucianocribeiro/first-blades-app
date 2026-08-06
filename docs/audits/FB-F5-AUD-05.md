# FB-F5-AUD-05 — Auditoría de Codex

- **ID:** FB-F5-AUD-05
- **PR auditada:** #42
- **Rama:** `fase-5/f5-06-procedimientos`
- **Fecha:** 2026-08-06
- **Veredicto:** `LIMPIO CON OBSERVACIONES`

---

# FB-F5-AUD-05 — Auditoría del módulo Procedimientos

## Hallazgo 1 — Falta filtro de aplicación en URL directa de detalle archivado

- **Severidad:** Media
- **Ubicación:** `/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/procedimientos/[id]/page.tsx:24`
- **Evidencia:** La página de detalle consulta `procedures` solo por `id` (`.eq('id', id).maybeSingle()`) y el comentario declara que se apoya en RLS para ocultar archivados a no-admin. No hay filtro de aplicación adicional `estado = 'vigente'` para usuarios no-admin en la ruta directa.
- **Regla violada:** `docs/prompts/FB-F5-06.md` exige que los archivados no sean visibles por URL directa y que el filtro de aplicación esté superpuesto a RLS.
- **Recomendación:** Agregar filtro explícito de aplicación en el detalle: no-admin debe consultar con `estado = 'vigente'`; admin puede consultar ambos estados. Agregar test/e2e de URL directa a un procedimiento archivado como empleado/supervisor.

## Hallazgo 2 — `file_path` se serializa al cliente en el formulario de edición

- **Severidad:** Media
- **Ubicación:** `/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/procedimientos/[id]/editar/page.tsx:50` y `/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/procedimientos/ProcedimientoForm.tsx:13`
- **Evidencia:** La página de edición pasa `filePath: procedimiento.file_path` al componente cliente `ProcedimientoForm`. Aunque el cliente solo lo usa como indicador booleano para elegir el modo inicial, el valor real queda serializado en el payload del cliente.
- **Regla violada:** `docs/prompts/FB-F5-06.md` exige que `file_path` no quede expuesto en el cliente.
- **Recomendación:** Pasar solo un booleano o enum, por ejemplo `hasFile` / `tipoContenidoInicial`, y mantener el `file_path` real únicamente del lado servidor.

## Hallazgo 3 — Las Server Actions no cumplen completamente el contrato return-based para no-admin

- **Severidad:** Media
- **Ubicación:** `/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/procedimientos/actions.ts:46`, `/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/procedimientos/actions.ts:106`, `/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/procedimientos/actions.ts:204`, `/Users/lucianocr/Desktop/Dev/first-blades-app/lib/auth.ts:29`
- **Evidencia:** Las tres acciones llaman `requireAdmin()` antes de devolver la unión `{ ok: true } | { ok: false, error }`. `requireAdmin()` termina en `redirect('/dashboard')` cuando el rol no corresponde; en Next eso corta el flujo mediante excepción/control flow. Los tests mockean `redirect` como no-op y verifican que fue llamado, pero no sostienen el contrato de retorno para ese caso.
- **Regla violada:** `docs/prompts/FB-F5-06.md` pide Server Actions return-based, sin errores amigables cruzando la frontera de acción.
- **Recomendación:** Usar un guard específico para acciones que devuelva `{ ok: false, error }` ante falta de permisos, o documentar explícitamente el `redirect` como excepción intencional y ajustar el contrato/tests.

## Hallazgo 4 — El flujo real de upload no tiene e2e

- **Severidad:** Media
- **Ubicación:** `/Users/lucianocr/Desktop/Dev/first-blades-app/tests/e2e/procedimientos.spec.ts:10`
- **Evidencia:** El archivo declara que no cubre upload real por Storage. La cobertura existente valida MIME/tamaño y llamadas a Storage con mocks, pero no ejercita el cruce real `File` → Server Action → Storage → URL firmada en entorno Next/Playwright.
- **Regla violada:** Desviación declarada en `docs/prompts/FB-F5-06.md`; por el antecedente de bugs visibles solo en producción/Next, el riesgo no queda completamente cubierto por unit tests.
- **Recomendación:** Agregar al menos un e2e con admin subiendo un `.txt` o `.pdf` pequeño, validando creación, detalle con link firmado y reemplazo/eliminación al editar.

## Controles limpios

- **Markdown sanitization:** `lib/markdown.ts` usa `marked` seguido siempre por `sanitize-html`. Rechaza scripts/event handlers/iframes/javascript URLs/style attrs y fuerza `target="_blank"` + `rel="noopener noreferrer"` en links. El único `dangerouslySetInnerHTML` del módulo usa ese HTML sanitizado.
- **Escrituras de procedimientos:** En el módulo no encontré `insert`, `update`, `upsert` ni `delete` directos sobre `procedures`. Las escrituras funcionales pasan por `crear_procedimiento`, `actualizar_procedimiento` y `archivar_procedimiento`.
- **Sin `createAdminClient()` en el módulo:** Las acciones y páginas del módulo usan `createServerClient()`. El `createAdminClient()` que aparece en `lib/storage.ts` pertenece a wrappers existentes de documentos, no a las funciones nuevas de procedimientos.
- **Archivados en listados:** Listado, búsqueda y categorías filtran `estado = 'vigente'` para no-admin. Admin puede ver archivados cuando activa el control correspondiente.
- **Exclusividad texto/archivo:** La app valida server-side "texto o archivo, nunca ambos" y el código documenta que la DB acepta ambos por compatibilidad, mientras la app impone la regla más estricta.
- **Storage:** Validación server-side de MIME y tamaño presente; URL firmada se genera server-side; no observé exposición de signed URLs antes de pasar por el servidor.
- **Badge Nuevo:** Usa helper de zona horaria `America/Argentina/Buenos_Aires` y tests cubren el borde exacto de 7 días.
- **RLS/integration:** La desviación de no usar `service_role` en tests de RLS es aceptable: los tests ejercitan JWT con `SET LOCAL ROLE authenticated`, que es el recorte relevante para empleados/supervisores/admin.
- **Higiene:** No hay migración nueva, no hay cambios en `supabase/types.ts`, y no vi cambios en UI/Server Actions fuera del módulo que contradigan el alcance. CI de PR #42 figura verde con 3 jobs principales y Vercel.

## Veredicto

**LIMPIO CON OBSERVACIONES**

No detecté hallazgos bloqueantes bajo el criterio pedido: no vi exposición efectiva de procedimientos archivados a roles indebidos por la base, no vi ejecución de Markdown sin sanitizar y no vi escrituras no auditadas/directas sobre `procedures`.

¿Esta migración/módulo está en condiciones de aplicarse a producción? **Sí, desde los criterios bloqueantes definidos; quedan observaciones no bloqueantes para cerrar antes de dar por terminada la fase.**

---

Los 4 hallazgos de este informe (Media, no bloqueantes) se resolvieron en FB-F5-07: filtro de aplicación explícito en el detalle (Hallazgo 1), reemplazo de `file_path` por un booleano en las props del cliente (Hallazgo 2), documentación de la excepción `redirect()` en `actions.ts` y en `docs/constitucion.md` §2.5 (Hallazgo 3), y un e2e nuevo con upload real de archivo, verificación de link firmado y borrado del archivo reemplazado (Hallazgo 4).
