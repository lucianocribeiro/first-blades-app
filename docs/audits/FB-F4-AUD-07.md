# FB-F4-AUD-07 — Informe de auditoría (Codex)

Alcance: FB-F4-10 / PR #27 — formulario de Solicitud de Pasaje, cola única de Aprobaciones, previsualización de sobrescritura sobre `dias_viaje`, resolución vía `resolver_pasaje_request` y mail best-effort. Auditado contra Constitución v0.6 (§4, §6, §6.1, §7, §12) y prompt `FB-F4-10`. No escribe código de feature.

## Hallazgos

Sin hallazgos.

## Verificaciones limpias

- **Scope de `empleado_id`:** `createPasajeRequest()` no confía en el payload. Para rol `empleado`, fuerza `empleado_id = profile.id` aunque llegue otro `empleadoId` desde el cliente (`app/(app)/solicitud-pasaje/actions.ts:35-38`). Para rol `supervisor`, exige `empleadoId` y revalida server-side `profiles.id = candidateId` + `profiles.supervisor_id = profile.id` antes del insert; fuera de equipo rechaza antes de tocar `pasaje_requests` (`app/(app)/solicitud-pasaje/actions.ts:39-56`).
- **RLS coherente:** las policies existentes de `pasaje_requests` mantienen empleado propio, supervisor para si/equipo y admin completo (`supabase/migrations/0001_init.sql:304-353`). El PR no agrega migraciones ni contradice esas policies.
- **No-retroactiva server-side:** `validatePasajeRequestInput()` exige `dias_viaje.length > 0` y rechaza si algun dia discreto es anterior a `getBusinessToday()`; hoy esta permitido porque el chequeo es `< today` (`app/(app)/solicitud-pasaje/logic.ts:30-54`). El test cubre un array mixto con un dia pasado y dias futuros (`tests/unit/solicitud-pasaje.test.ts:160-174`, `tests/unit/solicitud-pasaje.test.ts:377-390`).
- **Payload de alta:** `solicitante_id`, `empleado_id` y `estado` se resuelven en servidor; `dias_viaje` se dedupea/ordena y `fecha_viaje` legacy se completa con el primer dia ordenado (`app/(app)/solicitud-pasaje/logic.ts:57-82`).
- **Previsualizacion de sobrescritura:** reutiliza el contrato `OverwriteStatus = { status: 'ok'; days } | { status: 'error' }` (`app/(app)/aprobaciones/page.tsx:23-30`). Pasajes consultan `rotation_assignments` con `.eq('user_id', req.empleado_id).in('fecha', dias)`, es decir calendario del empleado que viaja y fechas exactas de `dias_viaje`, no rango `min..max` (`app/(app)/aprobaciones/page.tsx:148-170`). La query trae `es_estimado` y lo muestra en el aviso (`app/(app)/aprobaciones/AprobacionesTable.tsx:93-105`).
- **Error visible en sobrescritura:** un fallo puntual setea `{ status: 'error' }`, se loguea y la UI muestra `No se pudo calcular la previsualización de sobrescritura.` sin bloquear aprobar/rechazar (`app/(app)/aprobaciones/page.tsx:161-167`, `app/(app)/aprobaciones/AprobacionesTable.tsx:157-162`).
- **Resolución vía RPC:** `approvePasaje()` y `rejectPasaje()` usan `createServerClient()` y llaman solo a `resolver_pasaje_request`; no escriben calendario, estado ni audit por su cuenta (`app/(app)/aprobaciones/pasaje-actions.ts:75-98`, `app/(app)/aprobaciones/pasaje-actions.ts:132-155`). Ambas actions re-leen la solicitud antes de resolver y exigen `estado = 'pendiente'` (`app/(app)/aprobaciones/pasaje-actions.ts:31-45`). El rechazo valida motivo no vacio antes de la RPC (`app/(app)/aprobaciones/pasaje-actions.ts:132-145`).
- **RPC existente alineada con §6.1:** `resolver_pasaje_request` es `SECURITY DEFINER`, fija `search_path`, chequea admin con `auth.uid()` y `public.is_admin()`, usa `SELECT ... FOR UPDATE`, rechaza no pendiente, revoca `PUBLIC`/`anon` y concede `EXECUTE` a `authenticated` (`supabase/migrations/0016_resolver_pasaje.sql:54-215`).
- **Cola de Aprobaciones:** `/aprobaciones` trae documentos, ausencias y pasajes pendientes, ordenados en bandeja unica; pasajes incluyen solicitante, empleado, motivo amigable, origen/destino y dias discretos (`app/(app)/aprobaciones/page.tsx:36-72`, `app/(app)/aprobaciones/AprobacionesTable.tsx:135-163`).
- **Copy / helper compartido:** `translateResolverAusenciaError()` solo matchea el texto generico "ya fue resuelta" y devuelve copy de aprobaciones, sin mencionar ausencia al usuario (`app/(app)/aprobaciones/ausencia-logic.ts:10-22`; uso en `app/(app)/aprobaciones/pasaje-actions.ts:90-95`, `app/(app)/aprobaciones/pasaje-actions.ts:147-152`).
- **Mail best-effort:** el mail se envia despues de RPC exitosa, al `empleado_profile.email` de quien viaja, con subject/intro de solicitud de pasaje, motivo amigable, recorrido, dias y motivo de rechazo si aplica. Fallos o email ausente no revierten la resolucion; devuelven `emailSent:false` (`app/(app)/aprobaciones/pasaje-actions.ts:100-129`, `app/(app)/aprobaciones/pasaje-actions.ts:157-184`, `lib/email/pasaje-resolution-email.ts:33-164`).
- **Copy es-AR y sin jerga:** los textos nuevos viven en `/lib/copy` y exponen labels amigables para `motivo_viaje`, estados, sobrescritura y emails (`lib/copy/index.ts:310-370`, `lib/copy/index.ts:382-433`, `lib/copy/index.ts:491-511`).
- **Seguridad §12:** el diff no toca migraciones ni `supabase/functions`; no agrega secretos ni uso nuevo de `createAdminClient()` para pasajes. La aparicion de `createAdminClient()` en `/aprobaciones/actions.ts` pertenece al flujo preexistente de documentos, fuera del scope de PR #27.

## Pruebas ejecutadas

- `npm test -- --run tests/unit/solicitud-pasaje.test.ts tests/unit/aprobaciones-page-pasaje.test.ts tests/unit/aprobaciones-pasaje.test.ts tests/unit/aprobaciones-page-overwrite.test.ts tests/unit/aprobaciones-page-saldo.test.ts` — 53 tests pasan.
- `npm run typecheck` — pasa.
- `npm run build` — pasa.
- `git diff --check origin/main...HEAD` — sin salida.

## Veredicto

Aprobado para merge desde la auditoria de PR #27. No se requiere fix ni runbook de migracion para este diff app-only.
