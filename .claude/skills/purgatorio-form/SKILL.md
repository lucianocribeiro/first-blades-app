---
name: purgatorio-form
description: >
  Implementar un flujo "purgatorio" del Portal First Blades: un formulario nativo
  cuyo envío queda en estado Pendiente hasta que un admin lo aprueba o rechaza.
  Usar SIEMPRE que se construya una solicitud de pasaje, una solicitud de
  ausencia, una carga de documentos o cualquier alta que requiera aprobación de
  admin. Garantiza que nada se autoactiva, que el admin aprueba desde Aprobaciones
  y que el rechazo notifica para corregir.
---

# Skill: purgatorio-form

Patrón transversal de la constitución (§7). Aplica a documentos, onboarding/
precarga, solicitudes de pasaje y de ausencia. **Viáticos NO lo usa** (externo).

## Flujo

```
Empleado/Supervisor envía (formulario nativo)
  → registro con estado = pendiente   (NADA se autoactiva)
  → notificación al aprobador (admin)
  → Admin aprueba (aplica efecto) / rechaza (+ motivo_rechazo → notifica para corregir)
```

## Invariantes (no negociables)

1. **Nada llega a `aprobado` sin acción explícita de un admin.** El `INSERT` del
   solicitante fuerza `estado = pendiente` por RLS; no-admin no puede setear ni
   cambiar `estado`. (Ver `supabase-migration`.)
2. La transición de estado se registra en `audit_log` (quién, qué, cuándo).
3. El rechazo guarda `motivo_rechazo` y dispara notificación al solicitante para
   corregir y reenviar.

## Lado del solicitante (empleado/supervisor)

- Formulario sobre `design-system` (inputs con ícono, selects, date picker,
  textarea con contador, `InfoBanner` "Tu solicitud será revisada por
  Administración").
- Tras enviar, mostrar `StatusBadge` Pendiente + texto de estado.
- El supervisor puede enviar para sí y para su equipo donde la constitución lo
  permite (pasajes).

## Lado del aprobador (admin) — Aprobaciones

- La aprobación NO vive dentro de cada módulo: vive en la bandeja única
  **Aprobaciones**, que lista todo lo pendiente (pasajes + ausencias +
  documentos) en un solo lugar.
- Acciones: Aprobar (aplica efecto: p. ej. una ausencia aprobada genera
  `periodo_fuera_trabajo` en el calendario) / Rechazar (pide `motivo_rechazo`).
- Requiere auth de admin verificada en server + RLS. **Nunca** un link o token
  abierto de aprobación.

## Notificaciones

- Mail al aprobador en el alta, y al solicitante en aprobación/rechazo (Gmail,
  dirección por env). Si la dirección aún no está configurada, dejá el envío
  detrás de la env var sin romper el flujo.

## Tests

- Empleado/supervisor NO pueden crear un registro ya `aprobado`.
- No-admin NO puede aprobar ni cambiar estado (vía RLS).
- Rechazo guarda `motivo_rechazo` y notifica.
- `audit_log` registra la transición.
