# FB-F3-AUD-19 — Informe de auditoría (Codex)

Alcance: FB-F3-19 (PR #15) — cola de aprobación admin, acciones que invocan resolver_ausencia_request, condición de carrera y mails. No re-audita 0013 ni FB-F3-16.

## Hallazgos

### Medio — La server action acepta cualquier `requestId` de `ausencia_requests`
- **Ubicación:** `app/(app)/aprobaciones/ausencia-actions.ts:44`, `app/(app)/aprobaciones/ausencia-actions.ts:97`
- **Evidencia:** `approveAusencia(requestId)` y `rejectAusencia(requestId, motivo)` llaman directo a `resolver_ausencia_request` con el id recibido desde el cliente. La página lista solo `.eq('estado', 'pendiente').eq('motivo_ausencia', 'dia_tramite')`, pero la action no revalida ese scope server-side antes de resolver.
- **Regla violada:** el `p_request_id` debe venir del ítem de la cola server-side y no abrir una vía para resolver solicitudes fuera del scope de esta cola.
- **Recomendación:** antes de llamar la RPC, re-leer la solicitud como admin de sesión y exigir `estado = 'pendiente'` + `motivo_ausencia = 'dia_tramite'`; si no matchea, devolver copy amigable/genérico y no llamar la RPC ni enviar mail. Agregar test de action con una solicitud `vacaciones` pendiente.

## Verificaciones limpias
- Página `/aprobaciones` mantiene `requireAdmin()` y agrega la cola única sin recrear el módulo.
- Acciones de ausencias usan `createServerClient()`, no `createAdminClient()`, y no pasan identidad por parámetro.
- Acciones de documentos siguen separadas y usando `createAdminClient()` legítimamente.
- La cola filtra explícitamente `estado = 'pendiente'` y `motivo_ausencia = 'dia_tramite'`.
- Mails se envían solo después de RPC exitosa; carrera traducida no envía mail.
- Fallo de mail es best-effort: se loguea y devuelve `emailSent:false`.
- Rechazo vacío no llama RPC.
- Join embebido usa `profiles!ausencia_requests_user_id_fkey(full_name, email)`; no trae columnas sensibles del perfil.
- Sin credenciales hardcodeadas; Gmail usa env vars y scope `gmail.send`.
- Tests unitarios focalizados: 16/16 pasan localmente.
- Integración local se salteó por falta de PostgreSQL, pero PR #15 reporta integración Supabase local verde en CI.

## Veredicto
Requiere fix antes del merge. Es un fix de lógica de action, no solo-tests.

## Resolución
Cerrado con **FB-F3-20** (fix de lógica de action): ambas actions corren `assertInQueueScope()` antes de la RPC y del mail, exigiendo `estado = 'pendiente'` + `motivo_ausencia = 'dia_tramite'`; el caso `vacaciones` pendiente queda bloqueado (sin RPC, sin mail), con test agregado. Re-auditado limpio en **FB-F3-AUD-20**.
