-- 0022_import_calendario.sql
-- FB-PI-11 / FB-PI-11-B: import del calendario desde Excel (admin).
--
-- Inspección previa (delta-only, MCP Supabase, ref simfemdkrkdbumefcxei,
-- solo lectura — docs/audits/FB-PI-11-INSPECT.md y la auditoría de esquema
-- previa al push, docs/audits/FB-PI-11-SCHEMA-PREPUSH.md): última migración
-- en prod = 0021 (igual que local). rotation_assignments coincide con el
-- repo (0001 + 0009): UNIQUE (user_id, fecha), CHECK
-- rotation_assignments_motivo_requerido, sin triggers. profiles NO tiene
-- constraint de unicidad sobre email (solo pkey y profiles_dni_unique).
-- Prod: 27 perfiles, 0 duplicados de email por mayúsculas ni por espacios,
-- 0 emails con mayúsculas o espacios, 0 nulos. No existe ninguna función
-- importar_calendario ni índice profiles_email_normalizado_unique.
--
-- Delta real de esta migración:
--   1. Índice único profiles_email_normalizado_unique sobre
--      lower(btrim(email)) — la clave de identificación del import (PRD §3).
--   2. RPC importar_calendario(p_filas, p_esperado), SECURITY DEFINER,
--      molde §6.1.
-- Sin cambios de tablas, columnas, enums ni RLS.
--
-- ─── CAMBIO DE COMPORTAMIENTO DEL ALTA DE USUARIOS (decisión 3, FB-PI-11-B) ─
-- A partir del índice, dos perfiles cuyos emails difieran solo en
-- mayúsculas o en espacios al borde son IMPOSIBLES: el INSERT del trigger
-- handle_new_user (o cualquier UPDATE de profiles.email) falla con 23505.
-- Gestión de Usuarios (createUser) lo chequea antes de crear el usuario de
-- Auth y devuelve un error legible en es-AR
-- (copy.gestionUsuarios.errors.emailDuplicado), no el error crudo de base.
--
-- ─── EXCEPCIÓN DE audit_log (modelo híbrido, PRD §4 — llevar a la
-- constitución al cerrar el módulo) ────────────────────────────────────────
-- La convención vigente es una fila de audit_log por día de calendario
-- escrito (§6.1, 0016/0018). Esta función, y SOLO esta, registra:
--   - UNA fila de resumen por importación: action 'calendario_importado',
--     table_name 'rotation_assignments', record_id = import_id generado acá
--     (audit_log.record_id es NOT NULL y la importación no tiene una fila
--     propia), new_data = rango + conteos.
--   - UNA fila por día SOLO para los días que pisan una solicitud aprobada
--     (action 'calendario_importado_dia_pisado', record_id = id real de la
--     fila de rotation_assignments, import_id en new_data para vincularla
--     al resumen).
-- Toda otra escritura de calendario mantiene la convención por-día.
--
-- Auditoría vía PERFORM public.log_audit(...) (molde de 0020). Las funciones
-- 0013–0019 escriben con INSERT directo: inconsistencia heredada, fuera de
-- alcance, no se copia.

-- ============================================================
-- 1. ÍNDICE ÚNICO DE EMAIL NORMALIZADO
-- Mismo criterio que el matcheo del import (lower + btrim), en la base y en
-- la app (lib/rotation/calendario-import.ts::normalizarEmail). Si uno
-- normaliza y el otro no, se desincronizan.
-- ============================================================

CREATE UNIQUE INDEX profiles_email_normalizado_unique
  ON public.profiles (lower(btrim(email)));

-- ============================================================
-- 2. RPC: importar_calendario
--
-- p_filas: arreglo JSON, una entrada por fila del archivo:
--   { email, fecha (AAAA-MM-DD), estado_dia, motivo_ausencia,
--     motivo_otros_texto, notas }
--   estado_dia vacío/NULL = BORRAR ese día (PRD §4). Solo se tocan los
--   (email, fecha) presentes: una fila ausente no se borra.
-- p_esperado: los conteos que el admin vio en la previsualización:
--   { crear, modificar, borrar, sin_cambios, pisados }
--
-- La app ya validó todo (lib/rotation/calendario-import.ts); la función
-- vuelve a validar porque es el control real (el desplegable del Excel no lo
-- es, y la base no tiene CHECK para "motivo solo con Fuera del trabajo" ni
-- para motivo_otros_texto). Cualquier error aborta la transacción entera:
-- todo o nada. Sin loteo: una llamada = una transacción (INSPECT §6).
-- ============================================================

CREATE OR REPLACE FUNCTION public.importar_calendario(
  p_filas    JSONB,
  p_esperado JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import_id   UUID := gen_random_uuid();
  -- Fecha de negocio (AR), mismo criterio que getBusinessToday().
  v_hoy         DATE := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_entrada     JSONB;
  v_plan        JSONB;
  v_desde       DATE;
  v_hasta       DATE;
  v_total       INT;
  v_crear       INT;
  v_modificar   INT;
  v_borrar      INT;
  v_sin_cambios INT;
  v_pisados     INT;
  v_ord         BIGINT;
  v_email       TEXT;
  v_fecha       DATE;
  v_dia         RECORD;
BEGIN
  -- Guarda de admin (§6.1). auth.uid() IS NULL se chequea explícito:
  -- is_admin() da NULL (no false) sin sesión, y `IF NOT NULL` no dispara
  -- el RAISE en plpgsql.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede importar el calendario'
      USING ERRCODE = '42501';
  END IF;

  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'El lote del import está vacío o no es un arreglo' USING ERRCODE = '22023';
  END IF;

  -- La previsualización no se puede saltear: sin los conteos que el admin
  -- vio, no hay contra qué comparar y no se escribe nada.
  IF p_esperado IS NULL OR jsonb_typeof(p_esperado) <> 'object'
     OR NOT (p_esperado ?& ARRAY['crear', 'modificar', 'borrar', 'sin_cambios', 'pisados']) THEN
    RAISE EXCEPTION 'Faltan los conteos de la previsualización' USING ERRCODE = '22023';
  END IF;

  -- Serializa contra toda otra escritura de calendario (aprobaciones,
  -- edición manual, cron de estimados) mientras dura la transacción; las
  -- lecturas siguen. Una aprobación en curso que ya escribió calendario se
  -- espera; una que todavía no, espera a que termine el import. Así el
  -- recálculo de abajo ve un estado que nadie cambia hasta el commit.
  LOCK TABLE public.rotation_assignments IN SHARE ROW EXCLUSIVE MODE;

  -- ─── Normalización: mismo criterio que la app ─────────────────────────
  -- email: lower + btrim (índice de arriba). Textos: btrim, vacío = NULL.
  SELECT jsonb_agg(jsonb_build_object(
           'ord',                e.ord,
           'email',              lower(btrim(e.obj ->> 'email')),
           'fecha',              NULLIF(btrim(e.obj ->> 'fecha'), ''),
           'estado_dia',         NULLIF(btrim(e.obj ->> 'estado_dia'), ''),
           'motivo_ausencia',    NULLIF(btrim(e.obj ->> 'motivo_ausencia'), ''),
           'motivo_otros_texto', NULLIF(btrim(e.obj ->> 'motivo_otros_texto'), ''),
           'notas',              NULLIF(btrim(e.obj ->> 'notas'), '')
         ))
  INTO v_entrada
  FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS e(obj, ord);

  -- Los casts a date / estado_dia / motivo_ausencia de jsonb_to_recordset
  -- abortan solos ante un valor inválido (22007 / 22P02).

  -- ─── Validación (defensa en profundidad: la app ya filtró todo esto) ──
  SELECT x.ord INTO v_ord
  FROM jsonb_to_recordset(v_entrada) AS x(ord BIGINT, email TEXT, fecha DATE)
  WHERE x.email IS NULL OR x.email = '' OR x.fecha IS NULL
  ORDER BY x.ord LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Fila % del lote: faltan el email o la fecha', v_ord USING ERRCODE = '22023';
  END IF;

  SELECT x.email, x.fecha INTO v_email, v_fecha
  FROM jsonb_to_recordset(v_entrada) AS x(email TEXT, fecha DATE)
  GROUP BY x.email, x.fecha
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'El lote repite el día % de %', v_fecha, v_email USING ERRCODE = '22023';
  END IF;

  SELECT min(x.fecha), max(x.fecha), count(*) INTO v_desde, v_hasta, v_total
  FROM jsonb_to_recordset(v_entrada) AS x(fecha DATE);
  IF v_hasta - v_desde + 1 > 366 THEN
    RAISE EXCEPTION 'El rango del lote (% a %) supera los 366 días', v_desde, v_hasta USING ERRCODE = '22023';
  END IF;

  -- Cada email resuelve a EXACTAMENTE un perfil, y ese perfil está en el
  -- alcance del export: empleado o supervisor activo (decisión 2). El
  -- import nunca crea empleados.
  SELECT d.email INTO v_email
  FROM (SELECT DISTINCT x.email FROM jsonb_to_recordset(v_entrada) AS x(email TEXT)) AS d
  WHERE (SELECT count(*) FROM public.profiles p WHERE lower(btrim(p.email)) = d.email) <> 1
     OR NOT EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE lower(btrim(p.email)) = d.email
            AND p.role IN ('empleado', 'supervisor')
            AND p.status = 'activo'
        )
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'El email % no corresponde a un único empleado o supervisor activo', v_email
      USING ERRCODE = '22023';
  END IF;

  -- Forma de la fila: la base no tiene CHECK para estas reglas (solo
  -- rotation_assignments_motivo_requerido), así que las hace cumplir acá.
  SELECT x.ord INTO v_ord
  FROM jsonb_to_recordset(v_entrada) AS x(
    ord BIGINT, estado_dia estado_dia, motivo_ausencia motivo_ausencia,
    motivo_otros_texto TEXT, notas TEXT
  )
  WHERE (x.estado_dia IS NULL
          AND (x.motivo_ausencia IS NOT NULL OR x.motivo_otros_texto IS NOT NULL OR x.notas IS NOT NULL))
     OR (x.estado_dia = 'periodo_fuera_trabajo' AND x.motivo_ausencia IS NULL)
     OR (x.estado_dia IS DISTINCT FROM 'periodo_fuera_trabajo' AND x.motivo_ausencia IS NOT NULL)
     OR (x.motivo_ausencia = 'otros' AND x.motivo_otros_texto IS NULL)
     OR (x.motivo_ausencia IS DISTINCT FROM 'otros' AND x.motivo_otros_texto IS NOT NULL)
     OR char_length(x.motivo_otros_texto) > 80
  ORDER BY x.ord LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Fila % del lote: combinación de estado, motivo, detalle y notas inválida', v_ord
      USING ERRCODE = '22023';
  END IF;

  -- ─── Plan: el recálculo autoritativo, dentro de la transacción ────────
  -- accion:
  --   crear       — estado presente, el día no tiene fila;
  --   modificar   — estado presente, la fila existe y algún campo editable
  --                 difiere (estado, motivo, detalle, notas);
  --   borrar      — estado vacío y la fila existe;
  --   sin_cambios — el resto. Esas filas NO se tocan (ni updated_at ni
  --                 es_estimado): es lo que hace posible el ida y vuelta.
  -- solicitudes: las solicitudes aprobadas y no canceladas que cubren el
  -- día, con la misma condición que 0017 (ausencia por rango
  -- fecha_inicio..fecha_fin, pasaje por fecha discreta en dias_viaje). Un
  -- día "pisado" = cubierto + modificar/borrar (decisión 5).
  SELECT jsonb_agg(to_jsonb(pl) ORDER BY pl.ord)
  INTO v_plan
  FROM (
    SELECT
      x.ord,
      pr.id                   AS user_id,
      x.fecha,
      x.estado_dia,
      x.motivo_ausencia,
      x.motivo_otros_texto,
      x.notas,
      ra.id                   AS cal_id,
      ra.estado_dia           AS old_estado_dia,
      ra.motivo_ausencia      AS old_motivo_ausencia,
      ra.motivo_otros_texto   AS old_motivo_otros_texto,
      ra.notas                AS old_notas,
      ra.es_estimado          AS old_es_estimado,
      CASE
        WHEN x.estado_dia IS NULL AND ra.id IS NULL THEN 'sin_cambios'
        WHEN x.estado_dia IS NULL                    THEN 'borrar'
        WHEN ra.id IS NULL                           THEN 'crear'
        WHEN (ra.estado_dia, ra.motivo_ausencia, ra.motivo_otros_texto::text, ra.notas)
             IS NOT DISTINCT FROM
             (x.estado_dia, x.motivo_ausencia, x.motivo_otros_texto, x.notas)
                                                     THEN 'sin_cambios'
        ELSE 'modificar'
      END                     AS accion,
      cov.solicitudes
    FROM jsonb_to_recordset(v_entrada) AS x(
      ord BIGINT, email TEXT, fecha DATE, estado_dia estado_dia,
      motivo_ausencia motivo_ausencia, motivo_otros_texto TEXT, notas TEXT
    )
    JOIN public.profiles pr
      ON lower(btrim(pr.email)) = x.email
    LEFT JOIN public.rotation_assignments ra
      ON ra.user_id = pr.id AND ra.fecha = x.fecha
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('tipo', s.tipo, 'id', s.id) ORDER BY s.tipo, s.id) AS solicitudes
      FROM (
        SELECT 'ausencia'::text AS tipo, a.id
        FROM public.ausencia_requests a
        WHERE a.user_id = pr.id
          AND a.estado = 'aprobado'
          AND a.post_aprobacion_tipo IS DISTINCT FROM 'cancelada'
          AND x.fecha BETWEEN a.fecha_inicio AND a.fecha_fin
        UNION ALL
        SELECT 'pasaje'::text AS tipo, p.id
        FROM public.pasaje_requests p
        WHERE p.empleado_id = pr.id
          AND p.estado = 'aprobado'
          AND p.post_aprobacion_tipo IS DISTINCT FROM 'cancelada'
          AND x.fecha = ANY (p.dias_viaje)
      ) AS s
    ) AS cov ON true
  ) AS pl;

  SELECT
    count(*) FILTER (WHERE pl.accion = 'crear'),
    count(*) FILTER (WHERE pl.accion = 'modificar'),
    count(*) FILTER (WHERE pl.accion = 'borrar'),
    count(*) FILTER (WHERE pl.accion = 'sin_cambios'),
    count(*) FILTER (WHERE pl.accion IN ('modificar', 'borrar') AND pl.solicitudes IS NOT NULL)
  INTO v_crear, v_modificar, v_borrar, v_sin_cambios, v_pisados
  FROM jsonb_to_recordset(v_plan) AS pl(accion TEXT, solicitudes JSONB);

  -- ─── Concurrencia (decisión 1): la previsualización es una foto ───────
  -- Si entre la foto y la confirmación cambió algo, los conteos no
  -- coinciden y no se escribe nada: el admin vuelve a previsualizar.
  -- SQLSTATE propio FBC01 ("First Blades, calendario cambió"): la app lo
  -- traduce a ese mensaje. NO 40001 (serialization_failure): PostgREST 14
  -- toma la clase 40 como transitoria y reintenta la transacción sin fin
  -- (bug conocido, corregido en PostgREST 16 — ver
  -- docs/audits/FB-PI-11-SCHEMA-PREPUSH.md §3). Este aborto es
  -- determinístico: reintentarlo es un bucle infinito.
  IF (p_esperado ->> 'crear')::int       IS DISTINCT FROM v_crear
     OR (p_esperado ->> 'modificar')::int   IS DISTINCT FROM v_modificar
     OR (p_esperado ->> 'borrar')::int      IS DISTINCT FROM v_borrar
     OR (p_esperado ->> 'sin_cambios')::int IS DISTINCT FROM v_sin_cambios
     OR (p_esperado ->> 'pisados')::int     IS DISTINCT FROM v_pisados THEN
    RAISE EXCEPTION 'El calendario cambió desde la previsualización (esperado %, actual crear=% modificar=% borrar=% sin_cambios=% pisados=%)',
      p_esperado, v_crear, v_modificar, v_borrar, v_sin_cambios, v_pisados
      USING ERRCODE = 'FBC01';
  END IF;

  -- ─── audit_log por-día: SOLO los días pisados (antes de escribir, con
  -- el estado previo de cada celda) ────────────────────────────────────
  FOR v_dia IN
    SELECT *
    FROM jsonb_to_recordset(v_plan) AS pl(
      fecha DATE, estado_dia TEXT, motivo_ausencia TEXT, motivo_otros_texto TEXT, notas TEXT,
      cal_id UUID, old_estado_dia TEXT, old_motivo_ausencia TEXT, old_motivo_otros_texto TEXT,
      old_notas TEXT, old_es_estimado BOOLEAN, accion TEXT, solicitudes JSONB
    )
    WHERE pl.accion IN ('modificar', 'borrar') AND pl.solicitudes IS NOT NULL
  LOOP
    PERFORM public.log_audit(
      'calendario_importado_dia_pisado',
      'rotation_assignments',
      v_dia.cal_id,
      jsonb_build_object(
        'fecha',              v_dia.fecha,
        'estado_dia',         v_dia.old_estado_dia,
        'motivo_ausencia',    v_dia.old_motivo_ausencia,
        'motivo_otros_texto', v_dia.old_motivo_otros_texto,
        'notas',              v_dia.old_notas,
        'es_estimado',        v_dia.old_es_estimado
      ),
      jsonb_build_object(
        'import_id',          v_import_id,
        'accion',             CASE WHEN v_dia.accion = 'borrar' THEN 'borrado' ELSE 'modificado' END,
        'fecha',              v_dia.fecha,
        'estado_dia',         v_dia.estado_dia,
        'motivo_ausencia',    v_dia.motivo_ausencia,
        'motivo_otros_texto', v_dia.motivo_otros_texto,
        'notas',              v_dia.notas,
        'es_estimado',        CASE WHEN v_dia.accion = 'borrar' THEN NULL ELSE v_dia.fecha > v_hoy END,
        'solicitudes',        v_dia.solicitudes
      )
    );
  END LOOP;

  -- ─── Escritura por conjunto (no fila por fila: statement_timeout 8s) ──
  -- Upsert por UNIQUE (user_id, fecha), solo crear + modificar.
  -- es_estimado: futuro = proyección (true); hoy o pasado = real (false).
  -- El import no toca ausencia_requests ni pasaje_requests.
  INSERT INTO public.rotation_assignments
    (user_id, fecha, estado_dia, motivo_ausencia, motivo_otros_texto, notas, es_estimado)
  SELECT pl.user_id, pl.fecha, pl.estado_dia, pl.motivo_ausencia, pl.motivo_otros_texto, pl.notas,
         pl.fecha > v_hoy
  FROM jsonb_to_recordset(v_plan) AS pl(
    user_id UUID, fecha DATE, estado_dia estado_dia, motivo_ausencia motivo_ausencia,
    motivo_otros_texto TEXT, notas TEXT, accion TEXT
  )
  WHERE pl.accion IN ('crear', 'modificar')
  ON CONFLICT (user_id, fecha) DO UPDATE
    SET estado_dia         = EXCLUDED.estado_dia,
        motivo_ausencia    = EXCLUDED.motivo_ausencia,
        motivo_otros_texto = EXCLUDED.motivo_otros_texto,
        notas              = EXCLUDED.notas,
        es_estimado        = EXCLUDED.es_estimado,
        updated_at         = now();

  -- Celda de estado vacía = borrar el día (PRD §4).
  DELETE FROM public.rotation_assignments ra
  USING jsonb_to_recordset(v_plan) AS pl(cal_id UUID, accion TEXT)
  WHERE pl.accion = 'borrar' AND ra.id = pl.cal_id;

  -- ─── audit_log de resumen: una entrada por importación ────────────────
  PERFORM public.log_audit(
    'calendario_importado',
    'rotation_assignments',
    v_import_id,
    NULL,
    jsonb_build_object(
      'import_id',   v_import_id,
      'desde',       v_desde,
      'hasta',       v_hasta,
      'filas',       v_total,
      'creadas',     v_crear,
      'modificadas', v_modificar,
      'borradas',    v_borrar,
      'sin_cambios', v_sin_cambios,
      'pisadas',     v_pisados
    )
  );

  RETURN jsonb_build_object(
    'import_id',   v_import_id,
    'creadas',     v_crear,
    'modificadas', v_modificar,
    'borradas',    v_borrar,
    'sin_cambios', v_sin_cambios,
    'pisadas',     v_pisados
  );
END;
$$;

-- ─── Grants: molde §6.1 (mismo que 0019/0020) — solo `authenticated`
-- ejecuta; REVOKE explícito de PUBLIC y de anon (Supabase re-otorga a anon
-- por default privileges, no vía PUBLIC). Owner = quien corre la migración
-- (postgres), verificable por catálogo post-push.
REVOKE ALL ON FUNCTION public.importar_calendario(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.importar_calendario(JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.importar_calendario(JSONB, JSONB) TO authenticated;
