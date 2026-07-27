-- FB-F4-07: capa de datos para resolver Solicitud de Pasaje
--
-- (a) pasaje_requests.dias_viaje: fechas discretas del viaje (no un rango —
-- a diferencia de ausencia_requests, un viaje puede ser días sueltos, ej.
-- ida y vuelta con días intermedios sin franco). Nullable, para no romper
-- filas existentes; la columna legacy `fecha_viaje` (single date) queda
-- intacta, fuera de alcance de esta migración — FB-F4-08 (formulario)
-- decide su reconciliación. La obligatoriedad real de dias_viaje en un alta
-- nueva la impone la action de FB-F4-08, no la DB; acá solo se garantiza
-- que, si está presente, no sea un array vacío.
--
-- CHECK con cardinality(), NO array_length(): array_length(ARRAY[]::date[], 1)
-- devuelve NULL (no 0) para un array vacío — con `dias_viaje IS NULL OR
-- array_length(dias_viaje,1) >= 1`, un '{}' evaluaría toda la expresión a
-- NULL, y Postgres trata NULL como "constraint satisfecho" en un CHECK. Eso
-- dejaría pasar exactamente el caso que se quiere rechazar. cardinality()
-- sí devuelve 0 para un array vacío, sin ese footgun.
ALTER TABLE public.pasaje_requests
  ADD COLUMN dias_viaje DATE[];

ALTER TABLE public.pasaje_requests
  ADD CONSTRAINT pasaje_requests_dias_viaje_no_vacio
  CHECK (dias_viaje IS NULL OR cardinality(dias_viaje) >= 1);

-- (b) resolver_pasaje_request: análoga a resolver_ausencia_request
-- (0013/0015) — mismo molde de guardas (constitución §6.1): SECURITY
-- DEFINER con search_path fijo, guarda de admin con auth.uid() NULL =
-- no-admin explícito, SELECT ... FOR UPDATE exigiendo estado='pendiente',
-- REVOKE de PUBLIC y anon + GRANT solo a authenticated. La guarda de admin
-- de acá adentro es el control de seguridad real (bypassea la RLS
-- admin-only de audit_log/rotation_assignments a propósito).
--
-- Al aprobar, expande dias_viaje en N filas 'en_viaje' en el calendario del
-- empleado_id — quien viaja, no necesariamente quien solicitó (un
-- supervisor puede pedir pasaje para su equipo). estado_dia='en_viaje' no
-- lleva motivo_ausencia (esa columna es obligatoria solo para
-- periodo_fuera_trabajo, por el CHECK rotation_assignments_motivo_requerido
-- de 0009 — 'en_viaje' con motivo_ausencia=NULL es válido). Sobrescribe
-- cualquier fila existente en esos días (upsert sobre la UNIQUE
-- (user_id, fecha) de 0001/0009) y limpia motivo_ausencia/motivo_otros_texto
-- si el día pisado era periodo_fuera_trabajo. Todo el bloque es atómico:
-- basta con que un solo INSERT/UPDATE falle para que Postgres revierta el
-- cuerpo entero de la función (mismo mecanismo que resolver_ausencia_request,
-- sin BEGIN/COMMIT ni savepoints explícitos).
--
-- Al rechazar, no toca el calendario. Sin constraint de no-solapamiento
-- para pasaje en este MVP (decisión explícita — los días son discretos y la
-- sobrescritura + alerta de UI manejan el conflicto, FB-F4-08).
CREATE OR REPLACE FUNCTION public.resolver_pasaje_request(
  p_request_id     UUID,
  p_accion         TEXT,
  p_motivo_rechazo TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request           public.pasaje_requests%ROWTYPE;
  v_old_data          JSONB;
  v_new_data          JSONB;
  v_calendario_previo JSONB;
  v_dia               DATE;
BEGIN
  -- Guarda de admin — mismo razonamiento que resolver_ausencia_request:
  -- auth.uid() IS NULL se chequea explícito porque is_admin() devuelve NULL
  -- (no false) sin sesión, y `IF NOT NULL` no dispara el RAISE en plpgsql.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede resolver solicitudes de pasaje'
      USING ERRCODE = '42501';
  END IF;

  IF p_accion NOT IN ('aprobar', 'rechazar') THEN
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;

  -- Bloqueo de fila: serializa aprobaciones/rechazos concurrentes de la
  -- misma solicitud.
  SELECT * INTO v_request
  FROM public.pasaje_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud % no existe', p_request_id USING ERRCODE = 'P0002';
  END IF;

  IF v_request.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud % ya fue resuelta (estado actual: %)', p_request_id, v_request.estado
      USING ERRCODE = '22023';
  END IF;

  v_old_data := jsonb_build_object('estado', v_request.estado);

  IF p_accion = 'aprobar' THEN
    -- FOREACH sobre un array NULL lanza un error de Postgres poco amigable
    -- ("FOREACH expression must not be null"); esta guarda da un mensaje
    -- claro en es-AR para el mismo caso (fila legacy sin dias_viaje, previa
    -- a FB-F4-08). El CHECK de columna ya garantiza que, si no es NULL, no
    -- está vacío — no hace falta repetir esa validación acá.
    IF v_request.dias_viaje IS NULL THEN
      RAISE EXCEPTION 'La solicitud % no tiene días de viaje cargados', p_request_id
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.pasaje_requests
    SET estado      = 'aprobado',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at  = now()
    WHERE id = p_request_id;

    -- Captura el estado previo de las celdas del calendario que la
    -- aprobación va a pisar, para dejar la colisión auditada.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'fecha', fecha,
             'estado_dia_previo', estado_dia,
             'motivo_ausencia_previo', motivo_ausencia
           ) ORDER BY fecha), '[]'::jsonb)
    INTO v_calendario_previo
    FROM public.rotation_assignments
    WHERE user_id = v_request.empleado_id
      AND fecha = ANY (v_request.dias_viaje);

    v_new_data := jsonb_build_object(
      'estado', 'aprobado',
      'calendario_pisado', v_calendario_previo
    );

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'pasaje_approved', 'pasaje_requests', p_request_id, v_old_data, v_new_data);

    -- Upsert de rotation_assignments por cada fecha discreta de dias_viaje,
    -- en el calendario de empleado_id (quien viaja). en_viaje no lleva
    -- motivo_ausencia: se limpia explícito por si el día pisado era
    -- periodo_fuera_trabajo con un motivo cargado.
    FOREACH v_dia IN ARRAY v_request.dias_viaje LOOP
      INSERT INTO public.rotation_assignments
        (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado)
      VALUES
        (v_request.empleado_id, v_dia, 'en_viaje', NULL, NULL, false)
      ON CONFLICT (user_id, fecha) DO UPDATE
        SET estado_dia         = EXCLUDED.estado_dia,
            motivo_ausencia    = NULL,
            motivo_otros_texto = NULL,
            es_estimado        = EXCLUDED.es_estimado,
            updated_at         = now();
    END LOOP;

  ELSE -- rechazar
    IF p_motivo_rechazo IS NULL OR btrim(p_motivo_rechazo) = '' THEN
      RAISE EXCEPTION 'El motivo de rechazo es obligatorio' USING ERRCODE = '22023';
    END IF;

    UPDATE public.pasaje_requests
    SET estado         = 'rechazado',
        reviewed_by    = auth.uid(),
        reviewed_at    = now(),
        motivo_rechazo = p_motivo_rechazo,
        updated_at     = now()
    WHERE id = p_request_id;

    v_new_data := jsonb_build_object('estado', 'rechazado', 'motivo_rechazo', p_motivo_rechazo);

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'pasaje_rejected', 'pasaje_requests', p_request_id, v_old_data, v_new_data);
  END IF;
END;
$$;

-- Grants: solo authenticated puede invocarla vía RPC. Se revoca de PUBLIC
-- *y* explícitamente de anon (Supabase otorga EXECUTE vía ALTER DEFAULT
-- PRIVILEGES a anon/authenticated/service_role en toda función nueva del
-- schema public además del grant implícito a PUBLIC de CREATE FUNCTION;
-- revocar solo de PUBLIC no alcanza para sacarle el acceso a anon) — mismas
-- 3 sentencias que resolver_ausencia_request (0013), adaptadas a esta firma.
REVOKE ALL ON FUNCTION public.resolver_pasaje_request(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_pasaje_request(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolver_pasaje_request(UUID, TEXT, TEXT) TO authenticated;
