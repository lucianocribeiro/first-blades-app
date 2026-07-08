-- 0012_ausencia_requests_purgatorio_invariantes.sql
-- FB-F3-14: invariantes de purgatorio para ausencia_requests (base de Días de Trámite).
--
-- Inspección previa (delta-only): ausencia_requests ya existe desde 0001_init.sql
-- con tabla + RLS completas (empleado/supervisor insertan pendiente propia,
-- solo admin aprueba/rechaza, supervisor lee su equipo, RLS ya testeada en
-- tests/integration/rls.test.ts). motivo_ausencia y approval_status ya son
-- enums existentes y se reusan tal cual (sin crear ninguno nuevo). audit_log
-- ya existe (0001) para que FB-F3-15 registre las transiciones de estado vía
-- log_audit(). Un "día de trámite" puntual se modela con fecha_inicio =
-- fecha_fin (ya es el patrón usado en los tests existentes); no hace falta
-- una columna de fecha puntual nueva.
--
-- Lo único que falta son las invariantes de forma:
--   1. CHECK: estado = 'rechazado' ⇒ motivo_rechazo no vacío (mismo patrón
--      que documents_rechazo_requiere_motivo de 0006).
--   2. CHECK: estado <> 'pendiente' ⇒ reviewed_by y reviewed_at completos
--      (no se puede resolver una solicitud sin dejar quién y cuándo).
--   3. Índice único PARCIAL para evitar solicitudes pendientes duplicadas:
--      UNIQUE (user_id, motivo_ausencia, fecha_inicio, fecha_fin) WHERE
--      estado = 'pendiente'. Permite volver a solicitar la misma fecha si
--      la anterior quedó rechazada; no bloquea motivos o fechas distintas.

-- ─── CHECK: rechazo requiere motivo ────────────────────────────────────────
ALTER TABLE public.ausencia_requests
  ADD CONSTRAINT ausencia_requests_rechazo_requiere_motivo
  CHECK (
    estado <> 'rechazado'
    OR (motivo_rechazo IS NOT NULL AND btrim(motivo_rechazo) <> '')
  );

-- ─── CHECK: resolución requiere reviewed_by + reviewed_at ──────────────────
ALTER TABLE public.ausencia_requests
  ADD CONSTRAINT ausencia_requests_resolucion_completa
  CHECK (
    estado = 'pendiente'
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  );

-- ─── UNIQUE parcial: sin pendientes duplicados ─────────────────────────────
CREATE UNIQUE INDEX ausencia_requests_pendiente_unica
  ON public.ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin)
  WHERE estado = 'pendiente';
