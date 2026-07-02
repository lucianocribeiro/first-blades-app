-- 0008_notification_log.sql
-- FB-F2-07: log de notificaciones para idempotencia de alertas por email.
-- Clave (tipo, document_id, umbral, recipient_profile_id) evita reenvíos a cada
-- destinatario y permite reintento por destinatario ante fallos parciales.
-- Tabla interna del sistema: RLS activada SIN políticas para clientes (deny-all).
-- La escribe únicamente el cron vía service_role (que bypasea RLS). Ningún rol
-- de usuario la lee ni escribe por la API. Mismo patrón que audit_log.

-- Tipo de notificación (extensible a futuro; en Fase 2 solo vencimientos).
CREATE TYPE public.notification_type AS ENUM ('vencimiento_documento');

CREATE TABLE public.notification_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                 public.notification_type NOT NULL,
  document_id          UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  umbral               INTEGER NOT NULL,
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Umbrales de alerta previstos (días antes del vencimiento).
  CONSTRAINT notification_log_umbral_valido CHECK (umbral IN (5, 15, 30)),
  -- Idempotencia forzada en la base, no solo en app.
  CONSTRAINT notification_log_idempotencia
    UNIQUE (tipo, document_id, umbral, recipient_profile_id)
);

-- Índice para resolver "qué umbrales ya se enviaron" por documento+destinatario.
CREATE INDEX notification_log_lookup
  ON public.notification_log (tipo, document_id, recipient_profile_id);

-- RLS: deny-all para clientes. Sin políticas de SELECT/INSERT/UPDATE/DELETE.
-- El cron escribe con service_role, que bypasea RLS. Ningún rol de usuario
-- accede a esta tabla por la API pública.
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
