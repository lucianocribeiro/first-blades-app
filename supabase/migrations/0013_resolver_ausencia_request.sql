-- FB-F3-17: función atómica de resolución de solicitudes de ausencia
--
-- Resuelve (aprueba/rechaza) una fila de ausencia_requests de forma atómica:
-- ausencia_requests + audit_log (+ rotation_assignments si aprueba) se
-- escriben todos o ninguno. El cliente de Supabase no da transacción entre
-- sentencias sueltas; acá son múltiples sentencias dentro de UNA sola
-- invocación de función, así que Postgres revierte todo el cuerpo si
-- cualquier paso lanza una excepción no capturada (sin necesidad de
-- savepoints ni BEGIN/COMMIT explícitos en la función).
--
-- SECURITY DEFINER: corre con los privilegios del owner, así que bypassea
-- la RLS de audit_log (SELECT admin-only, sin policy de INSERT — deny-all
-- para el cliente) y de rotation_assignments (escritura admin-only). Por eso
-- la guarda de admin de acá ADENTRO es el control de seguridad real para
-- esta operación, no la RLS de esas tablas.
--
-- Esta migración entrega solo la función + sus guardas + grants. La cola de
-- aprobación (UI) y los mails son FB-F3-18.

CREATE OR REPLACE FUNCTION public.resolver_ausencia_request(
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
  v_request           public.ausencia_requests%ROWTYPE;
  v_old_data          JSONB;
  v_new_data          JSONB;
  v_calendario_previo JSONB;
  v_dia               DATE;
BEGIN
  -- Guarda de admin. auth.uid() IS NULL (anon / sin sesión) se chequea
  -- explícito y no solo "NOT is_admin()": si auth.uid() es NULL, is_admin()
  -- devuelve NULL (no false), y `IF NOT NULL` no dispara el RAISE en
  -- plpgsql (NULL se trata como "no entrar al IF", no como true). Sin este
  -- chequeo explícito, un contexto sin JWT colaría la guarda por accidente.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede resolver solicitudes de ausencia'
      USING ERRCODE = '42501';
  END IF;

  IF p_accion NOT IN ('aprobar', 'rechazar') THEN
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;

  -- Bloqueo de fila: serializa aprobaciones/rechazos concurrentes de la
  -- misma solicitud. La segunda invocación espera a que la primera termine
  -- (commit o rollback) y recién ahí lee el estado ya resuelto.
  SELECT * INTO v_request
  FROM public.ausencia_requests
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
    UPDATE public.ausencia_requests
    SET estado      = 'aprobado',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at  = now()
    WHERE id = p_request_id;

    -- Captura el estado previo de las celdas del calendario que la
    -- aprobación va a pisar, para dejar la colisión auditada en el mismo
    -- audit_log (no se descarta silenciosamente).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'fecha', fecha,
             'estado_dia_previo', estado_dia,
             'motivo_ausencia_previo', motivo_ausencia
           ) ORDER BY fecha), '[]'::jsonb)
    INTO v_calendario_previo
    FROM public.rotation_assignments
    WHERE user_id = v_request.user_id
      AND fecha BETWEEN v_request.fecha_inicio AND v_request.fecha_fin;

    v_new_data := jsonb_build_object(
      'estado', 'aprobado',
      'calendario_pisado', v_calendario_previo
    );

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'ausencia_approved', 'ausencia_requests', p_request_id, v_old_data, v_new_data);

    -- Upsert de rotation_assignments por cada día del rango
    -- [fecha_inicio, fecha_fin] (un día de trámite es un solo día).
    v_dia := v_request.fecha_inicio;
    WHILE v_dia <= v_request.fecha_fin LOOP
      INSERT INTO public.rotation_assignments (user_id, fecha, estado_dia, motivo_ausencia, es_estimado)
      VALUES (v_request.user_id, v_dia, 'periodo_fuera_trabajo', v_request.motivo_ausencia, false)
      ON CONFLICT (user_id, fecha) DO UPDATE
        SET estado_dia         = EXCLUDED.estado_dia,
            motivo_ausencia    = EXCLUDED.motivo_ausencia,
            motivo_otros_texto = NULL,
            es_estimado        = EXCLUDED.es_estimado,
            updated_at         = now();
      v_dia := v_dia + 1;
    END LOOP;

  ELSE -- rechazar
    IF p_motivo_rechazo IS NULL OR btrim(p_motivo_rechazo) = '' THEN
      RAISE EXCEPTION 'El motivo de rechazo es obligatorio' USING ERRCODE = '22023';
    END IF;

    UPDATE public.ausencia_requests
    SET estado         = 'rechazado',
        reviewed_by    = auth.uid(),
        reviewed_at    = now(),
        motivo_rechazo = p_motivo_rechazo,
        updated_at     = now()
    WHERE id = p_request_id;

    v_new_data := jsonb_build_object('estado', 'rechazado', 'motivo_rechazo', p_motivo_rechazo);

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'ausencia_rejected', 'ausencia_requests', p_request_id, v_old_data, v_new_data);
  END IF;
END;
$$;

-- Grants: solo el rol authenticated puede invocarla vía RPC; anon queda
-- afuera. La guarda de admin de arriba adentro hace el resto del control de
-- acceso (cualquier authenticated no-admin llega a la guarda y aborta).
-- Se revoca de PUBLIC *y* explícitamente de anon: Supabase aplica ALTER
-- DEFAULT PRIVILEGES otorgando EXECUTE a anon/authenticated/service_role en
-- toda función nueva del schema public, además del grant implícito a
-- PUBLIC que hace CREATE FUNCTION — revocar solo de PUBLIC no alcanza para
-- sacarle el acceso a anon.
REVOKE ALL ON FUNCTION public.resolver_ausencia_request(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_ausencia_request(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolver_ausencia_request(UUID, TEXT, TEXT) TO authenticated;
