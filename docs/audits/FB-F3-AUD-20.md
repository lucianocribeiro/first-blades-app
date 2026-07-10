# FB-F3-AUD-20 — Informe de re-auditoría acotada (Codex)

Alcance: solo el fix de FB-F3-20 (commit e830169 sobre PR #15) que cierra el hallazgo Medio de FB-F3-AUD-19.

## Hallazgos
Ninguno dentro del alcance de FB-F3-AUD-20.

## Verificaciones
- `assertInQueueScope()` corre antes de `.rpc(...)` en `approveAusencia` y `rejectAusencia`.
- El pre-check re-lee por `id` con `createServerClient()` y exige `estado = 'pendiente'` + `motivo_ausencia = 'dia_tramite'`.
- `vacaciones` pendiente queda bloqueada en ambas actions: no RPC, no mail.
- Solicitud ya resuelta o inexistente devuelve copy amigable y no llega a la RPC.
- Día de trámite pendiente sigue resolviendo normal y enviando mail post-éxito.
- El flujo de documentos no fue tocado por el commit e830169.
- PR #15 sigue con checks verdes.
- Local: `tests/unit/aprobaciones-ausencia.test.ts` pasó 17/17; integración focalizada se salteó por falta de PostgreSQL local, pero CI la reporta verde.

## Veredicto
Limpio para merge. El hallazgo Medio de FB-F3-AUD-19 queda cerrado.
