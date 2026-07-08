-- 0011_notification_log_franco_alertas.sql
-- FB-F3-13: soporte de idempotencia en notification_log para las alertas de
-- franco (sin_franco/franco_excedido), que no tienen document_id.
--
-- Inventario previo (ver prompt FB-F3-13): notification_log (0008) hoy tiene
-- document_id NOT NULL y su UNIQUE (tipo, document_id, umbral,
-- recipient_profile_id) asume que toda fila es de un documento. Las alertas
-- de franco identifican al empleado alertado (no un documento) y su
-- "episodio" es la racha vigente, no el documento.
--
-- Delta:
--   1. document_id pasa a NULLABLE (las alertas de franco no tienen documento).
--   2. empleado_id (FK profiles): a quién de alertan (destinatario admin ya
--      vive en recipient_profile_id).
--   3. racha_inicio (date): fecha de inicio de la racha vigente — el
--      "episodio". Si la racha se resetea y vuelve a cruzar el mismo umbral
--      más adelante, racha_inicio cambia → nuevo episodio → nuevo aviso.
--   4. CHECK de forma por tipo: una fila de documento SIEMPRE tiene
--      document_id y NUNCA empleado_id/racha_inicio; una fila de franco es
--      exactamente al revés. Ninguna fila queda ambigua.
--   5. CHECK de umbral válido, ahora condicionado por tipo (reemplaza el de
--      0008, que solo contemplaba 5/15/30 de vencimiento_documento).
--   6. Índice único PARCIAL para franco: UNIQUE (tipo, empleado_id, umbral,
--      racha_inicio, recipient_profile_id) WHERE document_id IS NULL. No
--      reemplaza la UNIQUE existente (que sigue cubriendo documentos, con
--      document_id NOT NULL en esas filas) — Postgres no compara NULLs como
--      iguales en una UNIQUE normal, así que las filas de franco (con
--      document_id NULL) nunca hubieran chocado contra esa constraint de
--      todos modos; el índice parcial es el mecanismo real de idempotencia
--      para franco.
--   7. RLS: sigue deny-all (0008), sin cambios — solo el cron escribe, vía
--      service_role.

-- ─── document_id: nullable ─────────────────────────────────────────────────
ALTER TABLE public.notification_log
  ALTER COLUMN document_id DROP NOT NULL;

-- ─── empleado_id: a quién se alerta (solo franco) ──────────────────────────
ALTER TABLE public.notification_log
  ADD COLUMN empleado_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ─── racha_inicio: episodio de la racha vigente (solo franco) ──────────────
ALTER TABLE public.notification_log
  ADD COLUMN racha_inicio DATE;

-- ─── CHECK: forma de la fila coherente con su tipo ─────────────────────────
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_forma_por_tipo
  CHECK (
    (tipo = 'vencimiento_documento'
      AND document_id IS NOT NULL
      AND empleado_id IS NULL
      AND racha_inicio IS NULL)
    OR
    (tipo IN ('sin_franco', 'franco_excedido')
      AND document_id IS NULL
      AND empleado_id IS NOT NULL
      AND racha_inicio IS NOT NULL)
  );

-- ─── CHECK: umbral válido, condicionado por tipo (reemplaza el de 0008) ────
ALTER TABLE public.notification_log
  DROP CONSTRAINT notification_log_umbral_valido;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_umbral_valido
  CHECK (
    (tipo = 'vencimiento_documento' AND umbral IN (5, 15, 30))
    OR (tipo = 'sin_franco' AND umbral IN (48, 60))
    OR (tipo = 'franco_excedido' AND umbral IN (10, 12))
  );

-- ─── Idempotencia de franco: índice único parcial ──────────────────────────
-- Deliberadamente separado de la UNIQUE de 0008 (ver punto 6 arriba).
CREATE UNIQUE INDEX notification_log_franco_idempotencia
  ON public.notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
  WHERE document_id IS NULL;

-- ─── Índice de lookup para franco (empleado + tipo, todas las filas) ───────
CREATE INDEX notification_log_franco_lookup
  ON public.notification_log (empleado_id, tipo)
  WHERE document_id IS NULL;
