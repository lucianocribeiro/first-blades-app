-- 0018_ausencia_audit_por_dia.sql
-- FB-F4-20: alinear el audit_log del lado ausencia a por-día (manera B),
-- para que todo el sistema audite el calendario con la misma granularidad.
--
-- Inspección previa (delta-only, MCP Supabase, ref simfemdkrkdbumefcxei,
-- solo lectura): última migración en prod = 0017 (igual que local). Se
-- confirmó verbatim, vía pg_get_functiondef, que:
--
--   - resolver_pasaje_request (0016/FB-F4-08) y
--     cancelar_editar_pasaje_aprobado (0017, rama editar_fechas) YA
--     registran el calendario por-día: 1 fila de transición sobre la
--     tabla de la request (new_data = {'estado': 'aprobado'} o
--     {..., 'dias_viaje': [...]}, SIN array de días embebido) + N filas
--     de audit_log con table_name='rotation_assignments', record_id=id
--     real de la fila upserteada, old_data/new_data de esa celda puntual.
--     Acciones: 'pasaje_calendario_sobrescrito' (aprobar) y
--     'pasaje_calendario_sobrescrito_post_edicion' (editar_fechas). Este
--     es el molde a replicar (§ decisión Luciano: manera B).
--
--   - resolver_ausencia_request (rama aprobar) agrupaba: capturaba TODOS
--     los días del rango pisados en un solo v_calendario_previo (jsonb_agg)
--     y lo embebía en la ÚNICA fila de transición
--     (audit_log.new_data.calendario_pisado, action='ausencia_approved').
--     No había ninguna fila de audit_log con table_name='rotation_assignments'
--     para el lado ausencia.
--
--   - cancelar_editar_ausencia_aprobada (rama editar_fechas) agrupaba
--     igual: v_calendario_previo vía jsonb_agg embebido en
--     new_data.calendario_pisado de la única fila
--     'ausencia_editada_post_aprobacion'. La rama cancelar (borrado de días
--     viejos, compartida con pasaje) YA es por-día
--     ('calendario_liberado_post_cancelacion') — no se toca.
--
--   - Firmas y catálogo (proowner=postgres, prosecdef=true,
--     proconfig=search_path=public, proacl solo postgres/authenticated/
--     service_role, sin anon/PUBLIC) verificados por catálogo para las 4
--     funciones — se preservan idénticos en este CREATE OR REPLACE.
--
--   - audit_log: id, actor_id, action, table_name, record_id, old_data,
--     new_data, created_at — sin cambios, coincide con el repo.
--
-- Alcance de este archivo: SOLO cambia cómo resolver_ausencia_request
-- (rama aprobar) y cancelar_editar_ausencia_aprobada (rama editar_fechas,
-- escritura de días NUEVOS) registran el audit_log — de 1 fila agrupada a
-- 1 fila de transición + N filas por-día, replicando el molde de pasaje.
-- Nomenclatura de action alineada: 'ausencia_calendario_sobrescrito' y
-- 'ausencia_calendario_sobrescrito_post_edicion' (análogos a los de
-- pasaje). No cambian guardas §6.1, firmas, lógica de negocio/calendario,
-- ni el comportamiento observable por el usuario (calendario, estado de
-- la solicitud, mails y UI resultantes son idénticos).

-- ─── RPC: resolver_ausencia_request ─────────────────────────────────────────
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
  v_request      public.ausencia_requests%ROWTYPE;
  v_old_data     JSONB;
  v_new_data     JSONB;
  v_cal_old_data JSONB;
  v_dia          DATE;
  v_cal_id       UUID;
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

    -- FB-F4-20: fila de transición de la request (molde de pasaje) — el
    -- detalle de qué días se pisaron ya NO va embutido acá; vive en una
    -- fila de audit_log propia por cada día, en el loop de abajo.
    v_new_data := jsonb_build_object('estado', 'aprobado');

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'ausencia_approved', 'ausencia_requests', p_request_id, v_old_data, v_new_data);

    -- Upsert de rotation_assignments por cada día del rango
    -- [fecha_inicio, fecha_fin] (un día de trámite es un rango de un solo
    -- día, así que el loop corre una sola vez para ese caso — mismo
    -- camino, sin rama especial). motivo_ausencia y motivo_otros_texto
    -- salen de la request, cualquiera sea el motivo.
    --
    -- FB-F4-20: alineado a la convención por-día de resolver_pasaje_request
    -- — cada día pisado deja su propia fila de audit_log
    -- (table_name='rotation_assignments', record_id=id real de la fila
    -- upserteada), en vez del molde agrupado anterior.
    v_dia := v_request.fecha_inicio;
    WHILE v_dia <= v_request.fecha_fin LOOP
      -- Estado previo de ESTE día puntual (NULL si el día estaba libre —
      -- no hay fila que capturar, y old_data queda NULL, no un objeto
      -- vacío).
      SELECT jsonb_build_object(
               'fecha', fecha,
               'estado_dia', estado_dia,
               'motivo_ausencia', motivo_ausencia,
               'motivo_otros_texto', motivo_otros_texto,
               'es_estimado', es_estimado
             )
      INTO v_cal_old_data
      FROM public.rotation_assignments
      WHERE user_id = v_request.user_id AND fecha = v_dia;

      INSERT INTO public.rotation_assignments
        (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado)
      VALUES
        (v_request.user_id, v_dia, 'periodo_fuera_trabajo', v_request.motivo_ausencia, v_request.motivo_otros_texto, false)
      ON CONFLICT (user_id, fecha) DO UPDATE
        SET estado_dia         = EXCLUDED.estado_dia,
            motivo_ausencia    = EXCLUDED.motivo_ausencia,
            motivo_otros_texto = EXCLUDED.motivo_otros_texto,
            es_estimado        = EXCLUDED.es_estimado,
            updated_at         = now()
      RETURNING id INTO v_cal_id;

      INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
      VALUES (
        auth.uid(),
        'ausencia_calendario_sobrescrito',
        'rotation_assignments',
        v_cal_id,
        v_cal_old_data,
        jsonb_build_object(
          'fecha',              v_dia,
          'estado_dia',         'periodo_fuera_trabajo',
          'motivo_ausencia',    v_request.motivo_ausencia,
          'motivo_otros_texto', v_request.motivo_otros_texto,
          'es_estimado',        false
        )
      );

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

-- ─── RPC: cancelar_editar_ausencia_aprobada ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_editar_ausencia_aprobada(
  p_request_id          UUID,
  p_accion               TEXT,
  p_comentario            TEXT,
  p_nueva_fecha_inicio   DATE DEFAULT NULL,
  p_nueva_fecha_fin      DATE DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request           public.ausencia_requests%ROWTYPE;
  v_dias_objetivo      DATE[];
  v_bloqueos           TEXT;
  v_old_cal            RECORD;
  v_old_data           JSONB;
  v_new_data           JSONB;
  v_cal_old_data       JSONB;
  v_dia                DATE;
  v_cal_id             UUID;
BEGIN
  -- Guarda de admin. auth.uid() IS NULL (anon / sin sesión) se chequea
  -- explícito por el mismo motivo que resolver_ausencia_request: is_admin()
  -- devuelve NULL (no false) sin sesión, y `IF NOT NULL` no dispara el RAISE.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cancelar o editar una ausencia aprobada'
      USING ERRCODE = '42501';
  END IF;

  IF p_accion NOT IN ('cancelar', 'editar_fechas') THEN
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;

  IF p_comentario IS NULL OR btrim(p_comentario) = '' THEN
    RAISE EXCEPTION 'El comentario es obligatorio para un cambio post-aprobación' USING ERRCODE = '22023';
  END IF;

  -- Bloqueo de fila: serializa cancelaciones/ediciones concurrentes de la
  -- misma solicitud.
  SELECT * INTO v_request
  FROM public.ausencia_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud % no existe', p_request_id USING ERRCODE = 'P0002';
  END IF;

  IF v_request.estado <> 'aprobado' THEN
    RAISE EXCEPTION 'La solicitud % no está aprobada (estado actual: %)', p_request_id, v_request.estado
      USING ERRCODE = '22023';
  END IF;

  IF v_request.post_aprobacion_tipo = 'cancelada' THEN
    RAISE EXCEPTION 'La solicitud % ya fue cancelada', p_request_id USING ERRCODE = '22023';
  END IF;

  -- Blindaje (FB-F4-13, FB-F4-AUD-08 Hallazgo Medio): la guarda LIFO ordena
  -- por reviewed_at — un objetivo aprobado sin ese dato (legacy/drift) no
  -- puede evaluarse de forma segura, así que se rechaza acá en vez de dejar
  -- que la comparación NULL del LIFO silenciosamente no bloquee nada.
  IF v_request.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'La solicitud % no tiene reviewed_at: no se puede evaluar el orden LIFO', p_request_id
      USING ERRCODE = '22023';
  END IF;

  IF p_accion = 'editar_fechas' THEN
    IF p_nueva_fecha_inicio IS NULL OR p_nueva_fecha_fin IS NULL THEN
      RAISE EXCEPTION 'Las fechas nuevas son obligatorias para editar_fechas' USING ERRCODE = '22023';
    END IF;

    -- FB-F4-13, FB-F4-AUD-08 Hallazgo Alto: sin esta guarda, un rango
    -- invertido borra los días viejos, el WHILE de abajo no escribe ninguno
    -- (v_dia > p_nueva_fecha_fin desde el arranque) y la solicitud queda con
    -- fecha_inicio > fecha_fin — inválido y sin días asignados en ningún lado.
    IF p_nueva_fecha_fin < p_nueva_fecha_inicio THEN
      RAISE EXCEPTION 'El rango de fechas nuevo es inválido: % es anterior a %', p_nueva_fecha_fin, p_nueva_fecha_inicio
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ─── Guarda LIFO ───────────────────────────────────────────────────────
  v_dias_objetivo := ARRAY(
    SELECT generate_series(v_request.fecha_inicio, v_request.fecha_fin, interval '1 day')::date
  );

  SELECT string_agg(
    format('%s %s (%s, aprobada %s)', b.tipo, b.id, b.fechas, b.reviewed_at),
    '; ' ORDER BY b.reviewed_at DESC
  )
  INTO v_bloqueos
  FROM (
    SELECT a.id, 'ausencia'::text AS tipo, a.reviewed_at,
           (a.fecha_inicio::text || ' a ' || a.fecha_fin::text) AS fechas
    FROM public.ausencia_requests a
    WHERE a.user_id = v_request.user_id
      AND a.estado = 'aprobado'
      AND a.id <> v_request.id
      AND a.reviewed_at > v_request.reviewed_at
      AND a.post_aprobacion_tipo IS DISTINCT FROM 'cancelada'
      AND ARRAY(SELECT generate_series(a.fecha_inicio, a.fecha_fin, interval '1 day')::date) && v_dias_objetivo

    UNION ALL

    SELECT p.id, 'pasaje'::text AS tipo, p.reviewed_at,
           array_to_string(p.dias_viaje, ', ') AS fechas
    FROM public.pasaje_requests p
    WHERE p.empleado_id = v_request.user_id
      AND p.estado = 'aprobado'
      AND p.reviewed_at > v_request.reviewed_at
      AND p.post_aprobacion_tipo IS DISTINCT FROM 'cancelada'
      AND p.dias_viaje && v_dias_objetivo
  ) AS b;

  IF v_bloqueos IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede % la solicitud %: hay aprobaciones posteriores que se superponen y deben resolverse primero: %',
      p_accion, p_request_id, v_bloqueos
      USING ERRCODE = '22023';
  END IF;

  v_old_data := jsonb_build_object(
    'fecha_inicio', v_request.fecha_inicio,
    'fecha_fin', v_request.fecha_fin,
    'post_aprobacion_tipo', v_request.post_aprobacion_tipo
  );

  -- ─── Borrado de los días viejos (cancelar y editar_fechas comparten esto) ─
  -- Solo se borran las filas que ESTA solicitud escribió (estado_dia =
  -- 'periodo_fuera_trabajo'); un día ya repintado a mano por el admin no se
  -- toca. Cada borrado deja su propia fila de audit_log (§4.2) — esta rama
  -- ya era por-día antes de FB-F4-20, no se toca.
  FOR v_old_cal IN
    SELECT id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado
    FROM public.rotation_assignments
    WHERE user_id = v_request.user_id
      AND fecha BETWEEN v_request.fecha_inicio AND v_request.fecha_fin
      AND estado_dia = 'periodo_fuera_trabajo'
  LOOP
    DELETE FROM public.rotation_assignments WHERE id = v_old_cal.id;

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      auth.uid(), 'calendario_liberado_post_cancelacion', 'rotation_assignments', v_old_cal.id,
      jsonb_build_object(
        'fecha', v_old_cal.fecha,
        'estado_dia', v_old_cal.estado_dia,
        'motivo_ausencia', v_old_cal.motivo_ausencia,
        'motivo_otros_texto', v_old_cal.motivo_otros_texto,
        'es_estimado', v_old_cal.es_estimado
      ),
      NULL
    );
  END LOOP;

  IF p_accion = 'cancelar' THEN
    UPDATE public.ausencia_requests
    SET post_aprobacion_tipo       = 'cancelada',
        comentario_post_aprobacion = p_comentario,
        post_aprobacion_at         = now(),
        updated_at                 = now()
    WHERE id = p_request_id;

    v_new_data := jsonb_build_object(
      'post_aprobacion_tipo', 'cancelada',
      'comentario_post_aprobacion', p_comentario
    );

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'ausencia_cancelada_post_aprobacion', 'ausencia_requests', p_request_id, v_old_data, v_new_data);

  ELSE -- editar_fechas
    -- FB-F4-20: escritura por día (molde de resolver_pasaje_request /
    -- cancelar_editar_pasaje_aprobado) — cada fecha reescrita deja su
    -- propia fila de audit_log, además de la de la transición de la
    -- request más abajo. Captura el old_data de cada día DESPUÉS del
    -- borrado de arriba: si un día está en ambos rangos, refleja el estado
    -- real en DB al momento de la escritura. Ya no se agrupa en
    -- new_data.calendario_pisado.
    v_dia := p_nueva_fecha_inicio;
    WHILE v_dia <= p_nueva_fecha_fin LOOP
      SELECT jsonb_build_object(
               'fecha', fecha,
               'estado_dia', estado_dia,
               'motivo_ausencia', motivo_ausencia,
               'motivo_otros_texto', motivo_otros_texto,
               'es_estimado', es_estimado
             )
      INTO v_cal_old_data
      FROM public.rotation_assignments
      WHERE user_id = v_request.user_id AND fecha = v_dia;

      INSERT INTO public.rotation_assignments
        (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado)
      VALUES
        (v_request.user_id, v_dia, 'periodo_fuera_trabajo', v_request.motivo_ausencia, v_request.motivo_otros_texto, false)
      ON CONFLICT (user_id, fecha) DO UPDATE
        SET estado_dia         = EXCLUDED.estado_dia,
            motivo_ausencia    = EXCLUDED.motivo_ausencia,
            motivo_otros_texto = EXCLUDED.motivo_otros_texto,
            es_estimado        = EXCLUDED.es_estimado,
            updated_at         = now()
      RETURNING id INTO v_cal_id;

      INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
      VALUES (
        auth.uid(),
        'ausencia_calendario_sobrescrito_post_edicion',
        'rotation_assignments',
        v_cal_id,
        v_cal_old_data,
        jsonb_build_object(
          'fecha',              v_dia,
          'estado_dia',         'periodo_fuera_trabajo',
          'motivo_ausencia',    v_request.motivo_ausencia,
          'motivo_otros_texto', v_request.motivo_otros_texto,
          'es_estimado',        false
        )
      );

      v_dia := v_dia + 1;
    END LOOP;

    UPDATE public.ausencia_requests
    SET fecha_inicio               = p_nueva_fecha_inicio,
        fecha_fin                  = p_nueva_fecha_fin,
        post_aprobacion_tipo       = 'editada',
        comentario_post_aprobacion = p_comentario,
        post_aprobacion_at         = now(),
        updated_at                 = now()
    WHERE id = p_request_id;

    v_new_data := jsonb_build_object(
      'post_aprobacion_tipo', 'editada',
      'comentario_post_aprobacion', p_comentario,
      'fecha_inicio', p_nueva_fecha_inicio,
      'fecha_fin', p_nueva_fecha_fin
    );

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'ausencia_editada_post_aprobacion', 'ausencia_requests', p_request_id, v_old_data, v_new_data);
  END IF;
END;
$$;

-- ─── Grants: re-aseverados tras el CREATE OR REPLACE (aprendizaje FB-F4-04:
-- dejar el estado explícito en la migración, no asumir que se preserva) ─────
REVOKE ALL ON FUNCTION public.resolver_ausencia_request(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_ausencia_request(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolver_ausencia_request(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancelar_editar_ausencia_aprobada(UUID, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_editar_ausencia_aprobada(UUID, TEXT, TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancelar_editar_ausencia_aprobada(UUID, TEXT, TEXT, DATE, DATE) TO authenticated;
