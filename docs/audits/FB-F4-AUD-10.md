# FB-F4-AUD-10 — Auditoría: edición post-aprobación (vista de aprobadas, cancelar/editar, LIFO, mail, visibilidad)

> Auditoría independiente de PR #31 `feat/fb-f4-14-cancelar-editar-app -> main` contra Constitución v0.6 (§2.4, §4, §6, §6.1, §7) y prompt `FB-F4-14`.
> Fecha: 2026-07-30.

## Hallazgos

### Medio — Pasajes pedidos por supervisor no muestran la marca post-aprobación al empleado viajero

**Ubicación:** `solicitud-pasaje/page.tsx:56`, RLS `pasajes_select` (`supabase/migrations/0001_init.sql:304`), `tests/unit/mis-solicitudes-post-aprobacion.test.tsx:40`.

**Evidencia:** la página "Mis solicitudes" de pasaje filtra explícitamente `.eq('solicitante_id', profile.id)`. Pero para pasajes, el dueño del calendario y destinatario del mail es `empleado_id`; RLS ya permite `empleado_id = auth.uid()`. Si un supervisor pide un pasaje para un empleado, el empleado recibe el mail post-aprobación, pero no ve en la app la marca `post_aprobacion_tipo`/comentario/timestamp porque no fue el `solicitante_id`. El test de visibilidad usa `solicitante_id === empleado_id`, así que no cubre este caso.

**Regla violada:** FB-F4-14 punto 10 y Constitución §2.4: la visibilidad in-app debe representar para el empleado el cambio comunicado por mail.

**Recomendación:** ajustar la query/lista de `solicitud-pasaje` para incluir pasajes donde el usuario sea solicitante o empleado viajero, con copy/columna que mantenga claro "Para quién" cuando corresponda. Agregar test con `solicitante_id='supervisor'` y `empleado_id='emp-1'` verificando que el empleado ve la marca post-aprobación.

## Confirmaciones

- Las 4 actions nuevas usan contrato return-based para errores esperados: `{ ok: true, emailSent } | { ok: false, error }`, y los call sites de mutación chequean `!result.ok` antes de mostrar éxito.
- La traducción LIFO no expone el prefijo crudo de Postgres y preserva la lista identificatoria de bloqueos. Comentario obligatorio, no-retroactiva y rango invertido se validan server-side antes de RPC.
- `/aprobadas` es admin-only vía `requireAdmin()`. Las RPCs se invocan con `createServerClient()`, con relectura previa de vigencia. Preview reusa `OverwriteStatus` y muestra error visible. Mail es best-effort post-commit. No hay cambios en `supabase/`, ni en `aprobaciones/ausencia-actions.ts` o `pasaje-actions.ts`; el bug latente allí está documentado en FB-F4-14 §8.
- Verificación: `npm run typecheck` pasó. Unit targeted pasó: 57 tests. PR #31 muestra CI verde en GitHub: typecheck/lint/tests/build, integración Supabase local, e2e Playwright y Vercel.

## Veredicto

No apruebo merge todavía. El fix return-based y el flujo admin están bien, pero falta cerrar la visibilidad in-app del cambio post-aprobación para pasajes donde el empleado no fue quien solicitó.
