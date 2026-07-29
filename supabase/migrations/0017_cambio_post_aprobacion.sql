-- 0017_cambio_post_aprobacion.sql
-- FB-F4-12: capa de datos para que el admin cancele o edite las fechas de
-- una ausencia/pasaje YA APROBADO, con comentario obligatorio, marcado
-- identificable y una guarda LIFO.
--
-- Inspección previa (delta-only, MCP Supabase, ref simfemdkrkdbumefcxei,
-- solo lectura): última migración en prod = 0016 (igual que local). Las
-- columnas de ausencia_requests/pasaje_requests, los cuerpos de
-- resolver_ausencia_request (0015) y resolver_pasaje_request (0016),
-- rotation_assignments y audit_log coinciden verbatim con los archivos de
-- este repo — sin drift. Ninguna de las tres columnas nuevas existe
-- todavía. Convención de enumeraciones confirmada por catálogo: el repo
-- usa EXCLUSIVAMENTE `CREATE TYPE ... AS ENUM` para dominios chicos y
-- cerrados (employee_status, approval_status, user_role, estado_dia,
-- motivo_ausencia, motivo_viaje, certificado_tipo, notification_type) —
-- nunca text + CHECK. post_aprobacion_tipo sigue esa misma convención: un
-- ENUM nuevo, no text+CHECK.
--
-- Diseño de las RPCs: mismo molde de guardas que resolver_ausencia_request
-- / resolver_pasaje_request (constitución §6.1) — SECURITY DEFINER,
-- search_path fijo, guarda de admin con auth.uid() IS NULL tratado
-- explícito como no-admin, SELECT ... FOR UPDATE, REVOKE de PUBLIC/anon +
-- GRANT solo a authenticated.
--
-- El "borrado de días viejos" (cancelar, y la primera mitad de
-- editar_fechas) dej a un audit_log POR FILA borrada (acción
-- 'calendario_liberado_post_cancelacion', old_data=fila previa,
-- new_data=NULL) — igual en ambas tablas, tal cual pide §4.2. La
-- "escritura de días nuevos" de editar_fechas respeta en cambio el molde
-- de auditoría PROPIO de cada tabla: ausencia sigue agrupada (un solo
-- audit_log de la transición de la request, con el array de días pisados
-- embebido en new_data.calendario_pisado — igual que resolver_ausencia_
-- request); pasaje sigue por-día (un audit_log por cada fecha reescrita en
-- rotation_assignments, además del audit_log de la transición de la
-- request) — igual que resolver_pasaje_request. No se unifican los dos
-- moldes: es una divergencia intencional ya presente entre 0015 y 0016.

-- ─── Enum del marcador de cambio post-aprobación ───────────────────────────
CREATE TYPE public.post_aprobacion_tipo AS ENUM ('editada', 'cancelada');

-- ─── Columnas nuevas: ausencia_requests ─────────────────────────────────────
ALTER TABLE public.ausencia_requests
  ADD COLUMN post_aprobacion_tipo        public.post_aprobacion_tipo,
  ADD COLUMN comentario_post_aprobacion  TEXT,
  ADD COLUMN post_aprobacion_at          TIMESTAMPTZ;

-- ─── Columnas nuevas: pasaje_requests ────────────────────────────────────────
ALTER TABLE public.pasaje_requests
  ADD COLUMN post_aprobacion_tipo        public.post_aprobacion_tipo,
  ADD COLUMN comentario_post_aprobacion  TEXT,
  ADD COLUMN post_aprobacion_at          TIMESTAMPTZ;

-- ─── RPC: cancelar_editar_ausencia_aprobada ─────────────────────────────────
-- Guarda LIFO: antes de tocar nada, calcula el conjunto de días que posee la
-- solicitud objetivo (expansión de [fecha_inicio, fecha_fin]) y verifica que
-- no exista, para el MISMO empleado, otra aprobación (ausencia O pasaje) con
-- reviewed_at posterior, no cancelada, cuyo conjunto de días intersecte el
-- del objetivo (aunque sea un solo día). Si existe, aborta identificando
-- id + tipo + fechas de cada bloqueo, ordenados del más reciente (el que hay
-- que resolver primero) al más antiguo.
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
  v_calendario_previo  JSONB;
  v_dia                DATE;
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

  IF p_accion = 'editar_fechas' AND (p_nueva_fecha_inicio IS NULL OR p_nueva_fecha_fin IS NULL) THEN
    RAISE EXCEPTION 'Las fechas nuevas son obligatorias para editar_fechas' USING ERRCODE = '22023';
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
  -- toca. Cada borrado deja su propia fila de audit_log (§4.2).
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
    -- Estado previo de los días NUEVOS (agrupado, molde de resolver_ausencia_
    -- request), capturado DESPUÉS del borrado de arriba: si un día está en
    -- ambos rangos, refleja el estado real en DB al momento de la escritura.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'fecha', fecha,
             'estado_dia_previo', estado_dia,
             'motivo_ausencia_previo', motivo_ausencia
           ) ORDER BY fecha), '[]'::jsonb)
    INTO v_calendario_previo
    FROM public.rotation_assignments
    WHERE user_id = v_request.user_id
      AND fecha BETWEEN p_nueva_fecha_inicio AND p_nueva_fecha_fin;

    v_dia := p_nueva_fecha_inicio;
    WHILE v_dia <= p_nueva_fecha_fin LOOP
      INSERT INTO public.rotation_assignments
        (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado)
      VALUES
        (v_request.user_id, v_dia, 'periodo_fuera_trabajo', v_request.motivo_ausencia, v_request.motivo_otros_texto, false)
      ON CONFLICT (user_id, fecha) DO UPDATE
        SET estado_dia         = EXCLUDED.estado_dia,
            motivo_ausencia    = EXCLUDED.motivo_ausencia,
            motivo_otros_texto = EXCLUDED.motivo_otros_texto,
            es_estimado        = EXCLUDED.es_estimado,
            updated_at         = now();
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
      'fecha_fin', p_nueva_fecha_fin,
      'calendario_pisado', v_calendario_previo
    );

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'ausencia_editada_post_aprobacion', 'ausencia_requests', p_request_id, v_old_data, v_new_data);
  END IF;
END;
$$;

-- ─── RPC: cancelar_editar_pasaje_aprobado ────────────────────────────────────
-- Misma guarda LIFO que la de ausencia, adaptada a días discretos
-- (dias_viaje) en vez de un rango.
CREATE OR REPLACE FUNCTION public.cancelar_editar_pasaje_aprobado(
  p_request_id   UUID,
  p_accion        TEXT,
  p_comentario     TEXT,
  p_nuevos_dias   DATE[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request      public.pasaje_requests%ROWTYPE;
  v_bloqueos     TEXT;
  v_old_cal      RECORD;
  v_old_data     JSONB;
  v_new_data     JSONB;
  v_cal_old_data JSONB;
  v_dia          DATE;
  v_cal_id       UUID;
BEGIN
  -- Guarda de admin — mismo razonamiento que resolver_pasaje_request.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede cancelar o editar un pasaje aprobado'
      USING ERRCODE = '42501';
  END IF;

  IF p_accion NOT IN ('cancelar', 'editar_fechas') THEN
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;

  IF p_comentario IS NULL OR btrim(p_comentario) = '' THEN
    RAISE EXCEPTION 'El comentario es obligatorio para un cambio post-aprobación' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.pasaje_requests
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

  IF p_accion = 'editar_fechas' AND (p_nuevos_dias IS NULL OR cardinality(p_nuevos_dias) = 0) THEN
    RAISE EXCEPTION 'Los días nuevos son obligatorios para editar_fechas' USING ERRCODE = '22023';
  END IF;

  -- ─── Guarda LIFO (mismo criterio que ausencia: cruza tipos, mira ambas
  -- tablas, solapamiento parcial cuenta) ──────────────────────────────────
  SELECT string_agg(
    format('%s %s (%s, aprobada %s)', b.tipo, b.id, b.fechas, b.reviewed_at),
    '; ' ORDER BY b.reviewed_at DESC
  )
  INTO v_bloqueos
  FROM (
    SELECT a.id, 'ausencia'::text AS tipo, a.reviewed_at,
           (a.fecha_inicio::text || ' a ' || a.fecha_fin::text) AS fechas
    FROM public.ausencia_requests a
    WHERE a.user_id = v_request.empleado_id
      AND a.estado = 'aprobado'
      AND a.reviewed_at > v_request.reviewed_at
      AND a.post_aprobacion_tipo IS DISTINCT FROM 'cancelada'
      AND ARRAY(SELECT generate_series(a.fecha_inicio, a.fecha_fin, interval '1 day')::date) && v_request.dias_viaje

    UNION ALL

    SELECT p.id, 'pasaje'::text AS tipo, p.reviewed_at,
           array_to_string(p.dias_viaje, ', ') AS fechas
    FROM public.pasaje_requests p
    WHERE p.empleado_id = v_request.empleado_id
      AND p.estado = 'aprobado'
      AND p.id <> v_request.id
      AND p.reviewed_at > v_request.reviewed_at
      AND p.post_aprobacion_tipo IS DISTINCT FROM 'cancelada'
      AND p.dias_viaje && v_request.dias_viaje
  ) AS b;

  IF v_bloqueos IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede % la solicitud %: hay aprobaciones posteriores que se superponen y deben resolverse primero: %',
      p_accion, p_request_id, v_bloqueos
      USING ERRCODE = '22023';
  END IF;

  v_old_data := jsonb_build_object(
    'dias_viaje', v_request.dias_viaje,
    'post_aprobacion_tipo', v_request.post_aprobacion_tipo
  );

  -- ─── Borrado de los días viejos (cancelar y editar_fechas comparten esto) ─
  FOR v_old_cal IN
    SELECT id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado
    FROM public.rotation_assignments
    WHERE user_id = v_request.empleado_id
      AND fecha = ANY(v_request.dias_viaje)
      AND estado_dia = 'en_viaje'
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
    UPDATE public.pasaje_requests
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
    VALUES (auth.uid(), 'pasaje_cancelado_post_aprobacion', 'pasaje_requests', p_request_id, v_old_data, v_new_data);

  ELSE -- editar_fechas
    -- Escritura por día (molde de resolver_pasaje_request): cada fecha
    -- reescrita deja su propia fila de audit_log, además de la de la
    -- transición de la request más abajo.
    FOREACH v_dia IN ARRAY p_nuevos_dias LOOP
      SELECT jsonb_build_object(
               'fecha', fecha,
               'estado_dia', estado_dia,
               'motivo_ausencia', motivo_ausencia,
               'motivo_otros_texto', motivo_otros_texto,
               'es_estimado', es_estimado
             )
      INTO v_cal_old_data
      FROM public.rotation_assignments
      WHERE user_id = v_request.empleado_id AND fecha = v_dia;

      INSERT INTO public.rotation_assignments
        (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, es_estimado)
      VALUES
        (v_request.empleado_id, v_dia, 'en_viaje', NULL, NULL, false)
      ON CONFLICT (user_id, fecha) DO UPDATE
        SET estado_dia         = EXCLUDED.estado_dia,
            motivo_ausencia    = NULL,
            motivo_otros_texto = NULL,
            es_estimado        = EXCLUDED.es_estimado,
            updated_at         = now()
      RETURNING id INTO v_cal_id;

      INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
      VALUES (
        auth.uid(),
        'pasaje_calendario_sobrescrito_post_edicion',
        'rotation_assignments',
        v_cal_id,
        v_cal_old_data,
        jsonb_build_object(
          'fecha',              v_dia,
          'estado_dia',         'en_viaje',
          'motivo_ausencia',    NULL,
          'motivo_otros_texto', NULL,
          'es_estimado',        false
        )
      );
    END LOOP;

    UPDATE public.pasaje_requests
    SET dias_viaje                 = p_nuevos_dias,
        post_aprobacion_tipo       = 'editada',
        comentario_post_aprobacion = p_comentario,
        post_aprobacion_at         = now(),
        updated_at                 = now()
    WHERE id = p_request_id;

    v_new_data := jsonb_build_object(
      'post_aprobacion_tipo', 'editada',
      'comentario_post_aprobacion', p_comentario,
      'dias_viaje', p_nuevos_dias
    );

    INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'pasaje_editado_post_aprobacion', 'pasaje_requests', p_request_id, v_old_data, v_new_data);
  END IF;
END;
$$;

-- ─── Grants: EXECUTE solo para authenticated, negado a anon y PUBLIC ────────
-- Mismas 3 sentencias que resolver_ausencia_request/resolver_pasaje_request,
-- por cada función nueva.
REVOKE ALL ON FUNCTION public.cancelar_editar_ausencia_aprobada(UUID, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_editar_ausencia_aprobada(UUID, TEXT, TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancelar_editar_ausencia_aprobada(UUID, TEXT, TEXT, DATE, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.cancelar_editar_pasaje_aprobado(UUID, TEXT, TEXT, DATE[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelar_editar_pasaje_aprobado(UUID, TEXT, TEXT, DATE[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancelar_editar_pasaje_aprobado(UUID, TEXT, TEXT, DATE[]) TO authenticated;
