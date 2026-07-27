# FB-F4-AUD-04 - Re-auditoria acotada: fixes de previsualizacion + mail generalizado

> Re-auditoria acotada de PR #23 `feat/fb-f4-05-ausencia-unificada -> main`, limitada a los dos hallazgos de `FB-F4-AUD-03` corregidos por `FB-F4-06`.
> Fecha: 2026-07-27.

## Veredicto

**Limpio.** Los dos hallazgos quedaron resueltos sin regresiones observadas en su vecindad. La previsualizacion de sobrescritura ya distingue error de rango libre, y los mails de resolucion quedaron generalizados para cualquier motivo de ausencia sin perder el comportamiento best-effort post-commit.

## Hallazgos

No se encontraron hallazgos en el alcance acotado.

## Verificaciones

- **Previsualizacion - contrato de estado:** `app/(app)/aprobaciones/page.tsx` define `OverwriteStatus = { status: 'ok'; days: OverwriteDay[] } | { status: 'error' }` y construye `overwriteStatusByRequest` por request. En error de query a `rotation_assignments`, setea explicitamente `{ status: 'error' }`; en exito, setea `{ status: 'ok', days: data ?? [] }`.
- **Previsualizacion - render de tres casos:** `app/(app)/aprobaciones/AprobacionesTable.tsx` muestra `copy.aprobaciones.sobrescritura.error` para `status='error'`, el aviso existente para `status='ok'` con `days.length > 0`, y nada para `status='ok'` con `days=[]`. El caso "no se pudo calcular" ya no colapsa con "sin dias a sobrescribir".
- **Previsualizacion - no bloqueante:** aprobar y rechazar siguen siendo los mismos botones por fila y no dependen de `overwriteStatusByRequest`. No se agregaron locks, confirmaciones duras ni bloqueo por error de previsualizacion.
- **Mail - relectura completa:** `app/(app)/aprobaciones/ausencia-actions.ts` re-lee post-RPC `fecha_inicio`, `fecha_fin`, `motivo_ausencia`, `motivo_otros_texto` y el perfil del destinatario antes de enviar el mail.
- **Mail - template generalizado:** `lib/email/ausencia-resolution-email.ts` usa subject/intro de "solicitud de ausencia", `motivoAusenciaLabel(...)` para motivo amigable y `formatRangoAusencia(...)` para periodo. El motivo `otros` incluye `motivo_otros_texto`; un rango de un solo dia se muestra como fecha unica.
- **Mail - rechazo:** el rename separa `motivoAusencia` de `motivoRechazo`; la action pasa `motivoRechazo: trimmed`, y el template lo renderiza bajo `motivoRechazoLabel`. No quedan referencias cruzadas al viejo campo ambiguo `motivo`.
- **Best-effort post-commit:** la RPC se invoca y las rutas se revalidan antes del bloque de envio; cualquier excepcion de mail queda atrapada, logueada y devuelve `emailSent:false`, sin revertir la resolucion.
- **Copy es-AR:** `lib/copy/index.ts` agrega el error visible de previsualizacion y generaliza los copies de mail a "solicitud de ausencia", sin nombres de enum ni jerga tecnica visible.
- **Sin esquema/RLS/RPC:** el delta de `FB-F4-06` no toca `supabase/`, `lib/supabase` ni `.env`. La logica de scope de resolucion se mantiene como "cualquier ausencia pendiente"; no se reintrodujo filtro por motivo.
- **Tests locales:** `npm run test -- tests/unit/aprobaciones-page-overwrite.test.ts tests/unit/aprobaciones-overwrite-aviso.test.tsx tests/unit/ausencia-resolution-email.test.ts tests/unit/aprobaciones-ausencia.test.ts` paso: 37 tests. `npm run typecheck` paso. `npm run build` paso.
- **Integracion:** `npm run test:integration -- tests/integration/aprobaciones-ausencia-queue.test.ts` quedo skipped localmente por falta de PostgreSQL. En CI de PR #23, el check `Tests de integracion RLS (Supabase local)` paso de verdad junto con `Typecheck - Lint - Tests - Build`.
- **Estado PR:** PR #23 esta abierto, no draft, `mergeStateStatus: CLEAN`, head `8b890833cb18ba7025f34da020e12c8e01d4ca30`. Checks verdes el 2026-07-27: integracion RLS, typecheck/lint/tests/build y Vercel.
