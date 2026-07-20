-- 0015_resolver_ausencia_rango.sql
-- FB-F4-03: propagación de motivo_otros_texto en la expansión de rango de
-- resolver_ausencia_request.
--
-- Inspección previa (delta-only, MCP Supabase, ref simfemdkrkdbumefcxei,
-- solo lectura) encontró que las dos hipótesis del prompt eran falsas:
-- resolver_ausencia_request (0013) YA expande el rango completo
-- [fecha_inicio, fecha_fin] día por día (WHILE v_dia <= fecha_fin LOOP) y YA
-- usa v_request.motivo_ausencia dinámicamente (no hardcodea 'dia_tramite')
-- para la fila del calendario. Eso nunca se testeó con un rango >1 día ni
-- con un motivo distinto de dia_tramite, pero no requiere cambio de SQL.
--
-- El delta real: ausencia_requests NO tenía motivo_otros_texto (a
-- diferencia de rotation_assignments, que sí la tiene desde 0009), así que
-- la función no tenía de dónde propagarlo para motivo = 'otros' y lo
-- hardcodeaba a NULL en el ON CONFLICT DO UPDATE. rotation_assignments NO
-- tiene un CHECK que ate motivo_otros_texto a motivo_ausencia = 'otros'
-- (confirmado por catálogo: su único CHECK es
-- rotation_assignments_motivo_requerido, sobre motivo_ausencia, no sobre
-- motivo_otros_texto) — por eso acá tampoco se agrega uno nuevo.
--
-- Firma sin cambios: resolver_ausencia_request(p_request_id uuid,
-- p_accion text, p_motivo_rechazo text DEFAULT NULL). Catálogo confirmado
-- antes del CREATE OR REPLACE: owner postgres, prosecdef=true,
-- proconfig={search_path=public}, proacl sin anon (solo
-- postgres/authenticated/service_role) — CREATE OR REPLACE preserva ACL
-- cuando no cambia la firma, así que no hace falta repetir REVOKE/GRANT.
-- Ninguna policy de ausencia_requests referencia una lista explícita de
-- columnas, así que la columna nueva no requiere tocar RLS.

-- ─── ausencia_requests: motivo_otros_texto ─────────────────────────────────
-- Espejo de rotation_assignments.motivo_otros_texto (mismo patrón que
-- documents.certificado_otros_texto de 0002_fase1_perfil.sql): texto libre
-- cuando motivo_ausencia = 'otros'. Arranca NULL en todas las filas
-- existentes, así que no viola nada. Sin CHECK, igual que su espejo.
ALTER TABLE public.ausencia_requests
  ADD COLUMN IF NOT EXISTS motivo_otros_texto VARCHAR(80);

-- ─── resolver_ausencia_request: propagar motivo_otros_texto al aprobar ─────
-- Único cambio funcional real: la fila de rotation_assignments que escribe
-- cada día del rango ahora incluye motivo_otros_texto de la request (antes
-- se descartaba a NULL incondicionalmente, incluso en el ON CONFLICT). El
-- resto del cuerpo (guardas de seguridad, expansión per-día, motivo
-- dinámico, auditoría agregada) es idéntico a 0013.
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
    -- [fecha_inicio, fecha_fin] (un día de trámite es un rango de un solo
    -- día, así que el loop corre una sola vez para ese caso — mismo
    -- camino, sin rama especial). motivo_ausencia y motivo_otros_texto
    -- salen de la request, cualquiera sea el motivo.
    v_dia := v_request.fecha_inicio;
    WHILE v_dia <= v_request.fecha_fin LOOP
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
