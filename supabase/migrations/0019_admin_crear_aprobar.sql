-- 0019_admin_crear_aprobar.sql
-- FB-ADJ-02 (fix del Hallazgo Alto de FB-ADJ-AUD-01): la secuencia previa de
-- FB-ADJ-01 para el envío de admin-para-sí era dos llamadas separadas desde
-- la Server Action — insert(pendiente) vía createServerClient() y luego
-- resolver_*_request(aprobar) vía otro round-trip — con un DELETE de
-- compensación si el segundo fallaba. Eso deja una ventana real: un crash
-- del proceso, un timeout de red, o un fallo del propio DELETE de limpieza
-- entre el INSERT y el resolver (o entre el resolver y el retorno) puede
-- dejar una solicitud de admin colgada (pendiente huérfana, o aprobada sin
-- que la action lo sepa). Esta migración reemplaza esa secuencia por UNA
-- sola RPC transaccional por tipo de solicitud, que inserta y aprueba en el
-- mismo statement — ningún fallo a mitad de camino puede dejar nada a
-- medias, porque un fallo en cualquier punto revierte TODO (el INSERT
-- incluido): no hay commit intermedio que compensar.
--
-- Diseño: crear_aprobar_ausencia_admin / crear_aprobar_pasaje_admin son
-- funciones PL/pgSQL nuevas que NO duplican la lógica de escritura de
-- calendario/audit_log de resolver_ausencia_request/resolver_pasaje_request
-- (0018/0016) — la REUSAN invocándola por PERFORM sobre la fila recién
-- insertada, dentro de la MISMA transacción. Una función PL/pgSQL invocada
-- vía SELECT/PERFORM no abre su propia transacción: corre en la del
-- llamador (acá, el statement `SELECT crear_aprobar_*_admin(...)` completo).
-- Una excepción en cualquier punto — el INSERT (choque con la exclusion
-- constraint de no-solapamiento, o con el CHECK de dias_viaje no-vacío), o
-- dentro de resolver_*_request (guarda de admin, colisión de calendario,
-- fallo de audit_log) — aborta la transacción entera: ni la request, ni el
-- calendario, ni el audit_log quedan con nada parcial. auth.uid() se resuelve
-- desde `request.jwt.claims` (una GUC de sesión, seteada por PostgREST/el
-- pooler a partir del JWT), no desde el rol SQL efectivo — por eso persiste
-- sin cambios a través de las dos capas de SECURITY DEFINER anidadas: la
-- guarda interna de is_admin() de resolver_*_request sigue viendo al MISMO
-- admin que invocó la RPC externa, no al owner de la función (postgres).
--
-- Admin-para-sí, sin excepción: ambas funciones fijan user_id/empleado_id/
-- solicitante_id = auth.uid() SIEMPRE — no reciben "para quién" como
-- parámetro. "Admin por otros" queda fuera de alcance (FB-ADJ-01 §2),
-- decisión aparte si se pide más adelante.
--
-- Reemplaza (no elimina): resolver_ausencia_request/resolver_pasaje_request
-- siguen siendo la única vía de resolución para TODAS las solicitudes no-
-- admin (vía la bandeja Aprobaciones) — estas dos funciones nuevas son
-- exclusivamente el atajo crear+aprobar de admin-para-sí.

-- ─── RPC: crear_aprobar_ausencia_admin ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_aprobar_ausencia_admin(
  p_motivo             motivo_ausencia,
  p_fecha_inicio       DATE,
  p_fecha_fin          DATE,
  p_motivo_otros_texto TEXT DEFAULT NULL,
  p_nota               TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
BEGIN
  -- Misma guarda que resolver_ausencia_request (§6.1): auth.uid() IS NULL se
  -- chequea explícito porque is_admin() da NULL (no false) sin sesión, y
  -- `IF NOT NULL` no dispara el RAISE en plpgsql.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede crear y auto-aprobar su propia solicitud de ausencia'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ausencia_requests
    (user_id, motivo_ausencia, motivo_otros_texto, fecha_inicio, fecha_fin, notas, estado)
  VALUES
    (auth.uid(), p_motivo, p_motivo_otros_texto, p_fecha_inicio, p_fecha_fin, p_nota, 'pendiente')
  RETURNING id INTO v_request_id;

  -- Sin BEGIN/COMMIT propio: corre en la transacción del llamador. Si esto
  -- lanza (guarda de admin — no debería, ya se validó arriba en la misma
  -- sesión — colisión de calendario, fallo de audit_log), el INSERT de
  -- arriba se revierte junto con todo lo demás.
  PERFORM public.resolver_ausencia_request(v_request_id, 'aprobar', NULL);

  RETURN v_request_id;
END;
$$;

-- ─── RPC: crear_aprobar_pasaje_admin ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_aprobar_pasaje_admin(
  p_motivo_viaje motivo_viaje,
  p_origen       TEXT,
  p_destino      TEXT,
  p_dias_viaje   DATE[],
  p_nota         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id  UUID;
  v_fecha_viaje DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede crear y auto-aprobar su propia solicitud de pasaje'
      USING ERRCODE = '42501';
  END IF;

  -- fecha_viaje: columna legacy NOT NULL (fecha única, previa a dias_viaje —
  -- ver migración 0016) — se completa con el día más temprano de
  -- p_dias_viaje. Calculado en SQL (no confiando en que el caller mande el
  -- array pre-ordenado) para que la función sea correcta de forma
  -- autocontenida. Si p_dias_viaje viene vacío, min() da NULL y el INSERT
  -- falla por el NOT NULL de fecha_viaje — la app ya valida "al menos un
  -- día" antes de invocar esta RPC (defensa en profundidad, no el único
  -- guardrail).
  v_fecha_viaje := (SELECT min(d) FROM unnest(p_dias_viaje) AS d);

  INSERT INTO public.pasaje_requests
    (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, dias_viaje, notas, estado)
  VALUES
    (auth.uid(), auth.uid(), p_motivo_viaje, v_fecha_viaje, p_origen, p_destino, p_dias_viaje, p_nota, 'pendiente')
  RETURNING id INTO v_request_id;

  PERFORM public.resolver_pasaje_request(v_request_id, 'aprobar', NULL);

  RETURN v_request_id;
END;
$$;

-- ─── Grants: mismo molde que resolver_ausencia_request/resolver_pasaje_request
-- (aprendizaje FB-F4-04: dejar el estado explícito en la migración, no
-- asumir que se preserva) — solo `authenticated` puede ejecutar, nunca
-- anon/PUBLIC. Owner = quien corre la migración (postgres en CI/deploy),
-- igual que el resto de las funciones SECURITY DEFINER del archivo.
REVOKE ALL ON FUNCTION public.crear_aprobar_ausencia_admin(motivo_ausencia, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_aprobar_ausencia_admin(motivo_ausencia, DATE, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_aprobar_ausencia_admin(motivo_ausencia, DATE, DATE, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.crear_aprobar_pasaje_admin(motivo_viaje, TEXT, TEXT, DATE[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_aprobar_pasaje_admin(motivo_viaje, TEXT, TEXT, DATE[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_aprobar_pasaje_admin(motivo_viaje, TEXT, TEXT, DATE[], TEXT) TO authenticated;
