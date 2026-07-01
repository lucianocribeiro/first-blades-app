---
name: email-notification
description: >
  Enviar una notificación por email desde el Portal First Blades reutilizando la
  capa `lib/email` (Gmail API). Usar SIEMPRE que un evento del backend deba
  avisar por correo a un usuario o a los admins (rechazo de documento, alerta de
  vencimiento, y a futuro aprobaciones de pasajes/ausencias en Fase 4). Garantiza
  destinatarios resueltos desde `profiles.email`, copy es-AR desde `/lib/copy`,
  envío no bloqueante y no silencioso, e idempotencia vía `notification_log`
  cuando el disparo es recurrente (cron).
---

# Skill: email-notification

Capa de notificaciones por email. Construida en Fase 2 con dos consumidores:
**rechazo de documento** (evento puntual, FB-F2-06) y **alertas de vencimiento**
(cron recurrente + idempotencia, FB-F2-07). Este es el patrón a reutilizar.

## Piezas (no reescribir)

- **`lib/email/send-email.ts`** → `sendEmail({ to, subject, html, text }, transport?)`.
  Arma RFC 2822 `multipart/alternative` + base64url y envía por Gmail API.
  El `transport` es **inyectable** (default = real): en tests se pasa un mock, en
  prod se usa el transporte real de `lib/email/gmail-transport.ts` (service
  account + domain-wide delegation, scope único `gmail.send`, envía como
  `GMAIL_SENDER_ADDRESS`).
- **Builders de contenido** (puros, devuelven `SendEmailParams`): ej.
  `lib/email/rejection-email.ts`, `lib/notifications/document-expiry-email.ts`.
  Estilos inline simples, marca First Blades (primario `#0D7EC7`), **escapan HTML**
  de todo valor dinámico.
- **`lib/copy`** → todos los textos en **es-AR** bajo `copy.emails.*`. Sin strings
  hardcodeados en los builders.

## Cómo agregar una notificación nueva

1. **Copy es-AR** en `copy.emails.<evento>` (subject + piezas de cuerpo).
2. **Builder puro** `build<Evento>Email(input): SendEmailParams` que arma `text`
   y `html` desde el copy y escapa lo dinámico. Testeable sin red.
3. **Resolver destinatarios SIEMPRE desde `profiles.email`** (nunca hardcodear ni
   listas externas). Empleado dueño y admins van en **emails separados** (framing
   y privacidad distintos); nunca mezclar audiencias en el mismo `To`/`CC`.
4. **Disparar** con `sendEmail(build<Evento>Email(...))`.

## Invariantes (no negociables)

- **No bloqueante:** el efecto principal (rechazo, transición de estado) es la
  fuente de verdad; un fallo de email **no** lo revierte.
- **No silencioso:** todo fallo de envío se **loguea visible** (`console.error`),
  nunca se traga. El caso `email` nulo se loguea como skip (`console.warn`) y no
  crashea.
- **es-AR** desde `/lib/copy`. **Sin secretos** en código (todo por env de FB-F2-06).
- **Transporte mockeable:** ningún test toca la red ni envía correo real.

## Idempotencia (solo disparos recurrentes / cron)

Para alertas que un cron reevalúa a diario, usar la tabla **`notification_log`**
(migración `0008`) con clave **(tipo, document_id, umbral, recipient_profile_id)**:

- **Puerto de datos inyectable** (`ExpiryDataStore` en
  `lib/notifications/document-expiry.ts`): la lógica de decisión es agnóstica de
  Supabase y se testea con un store en memoria; la impl real
  (`document-expiry-store.ts`) es fina y se cubre por integración.
- **Marcar-DESPUÉS-de-enviar:** registrar en `notification_log` **solo** tras un
  envío exitoso a ese destinatario. Un fallo **no** registra → se reintenta la
  próxima corrida.
- **Tolerancia a fallos parciales:** el fallo a un destinatario no bloquea a los
  demás.
- **Registrar todos los umbrales alcanzados** (no solo el disparado) para no
  reenviar los menos urgentes tarde. La `UNIQUE constraint` fuerza la idempotencia
  en la base, no solo en app (`upsert … ignoreDuplicates`).
- La tabla es **interna**: RLS activada **sin políticas** (deny-all); solo la
  escribe el cron vía `service_role` (que bypasea RLS). Mismo patrón que `audit_log`.

## Cron (disparo recurrente)

- Endpoint `GET /api/cron/<nombre>` que **calca** `purge-rejected-docs`:
  `Authorization: Bearer <CRON_SECRET>`, **falla cerrado** (401) sin secret o con
  secret incorrecto. La ruta es una cáscara: delega en un runner de `lib/`.
- Cliente **service_role** (sin sesión) → toda query **acotada explícitamente en
  código** (RLS no protege al service_role).
- Registrar el cron en `vercel.json` (horario off-peak, alineado con los demás).

## Testing

- Unit con `send`/transporte **mockeado**: contenido del email, resolución de
  destinatarios, y para crons: umbrales, idempotencia (doble corrida sin
  reenvío), catch-up, no-disparo-tardío, marcar-después-de-enviar, fallo parcial,
  email nulo, y auth del cron (401 falla cerrado).
- Integración contra Supabase local para el `notification_log` (constraint de
  idempotencia + RLS deny-all + store real end-to-end).
- **Verificación en vivo** (envío real) queda para el smoke test con los secretos
  de Workspace cargados; no corre en CI.
