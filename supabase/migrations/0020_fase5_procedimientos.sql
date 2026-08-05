-- 0020_fase5_procedimientos.sql
-- FB-F5-02: deja la base lista para Fase 5 (Procedimientos/Políticas +
-- arreglos de Gestión de Usuarios), sobre el estado real reportado en
-- docs/prompts/FB-F5-01-INSPECT-REPORT.md (inspección de solo-lectura,
-- proyecto simfemdkrkdbumefcxei, 2026-08-05): `procedures` vacía (0 filas,
-- sin caller en el código), columnas en inglés, sin CHECK de contenido, sin
-- columna de archivado, `procedures_select_all` abierta a todo autenticado;
-- `log_audit()` SECURITY DEFINER invocable hoy por `anon`/`authenticated`
-- vía REST sin guarda interna (el REVOKE FROM PUBLIC original de 0001 no
-- alcanzó a `anon`/`authenticated` porque Supabase les otorga EXECUTE por
-- default privileges explícitos por rol, no vía el pseudo-rol PUBLIC).
--
-- Decisiones de diseño (cerradas, no re-abrir — ver prompt FB-F5-02):
--   1. Renombre de columnas de `procedures` al español (tabla vacía, sin
--      callers: costo cero ahora, alto después).
--   2. Archivado vía enum `procedure_estado` {vigente, archivado} +
--      columna `estado`, mismo patrón que `approval_status`/`estado_dia`.
--   3. El archivado se oculta en la RLS (USING), no solo en la query de la
--      app — los límites viven en la base.
--   4. CHECK de contenido en la base: al menos `contenido_texto` (no vacío)
--      o `file_path`.
--   5. Auditoría por RPC SECURITY DEFINER atómica: cada operación de
--      `procedures` escribe la tabla + `audit_log` en la misma transacción,
--      vía `PERFORM public.log_audit(...)`. Se descarta abrir una policy de
--      INSERT en `audit_log` (superficie innecesaria) y se descarta un
--      trigger (contradice la convención real del repo: cero triggers,
--      todo vía Server Action/RPC — ver bloque A.5 del informe).
--   6. `log_audit()` se cierra: REVOKE EXECUTE de `anon`/`authenticated`/
--      PUBLIC. Sin guarda `is_admin()` interna (se preserva como helper
--      genérico para auditar acciones futuras de no-admin). El cierre no
--      rompe a las RPCs de este archivo: una función SECURITY DEFINER
--      ejecuta sus llamadas internas (PERFORM) con los privilegios del
--      OWNER de la función (postgres), no del invocador — el REVOKE a
--      anon/authenticated no le aplica a esa llamada interna.
--   7. Bucket de Storage nuevo y privado `procedimientos` — el bucket
--      `documents` asume `{userId}/` como dueño y un procedimiento no
--      tiene dueño individual, es de la empresa.
--   8. Sin `pg_trgm` ni índice de búsqueda: volumen de decenas de filas,
--      `ilike` alcanza.
--   9. Sin triggers: `updated_at`/`updated_by` los setean las RPCs.
--
-- Una sola migración a propósito: el `db push` es la única acción
-- irreversible del runbook y no hay staging — un push gateado es más
-- seguro que varios. `db push` NO se ejecuta desde este archivo/prompt.

-- ============================================================
-- 1. RENOMBRE DE COLUMNAS DE `procedures` (delta §1)
-- ============================================================

ALTER TABLE public.procedures RENAME COLUMN title        TO titulo;
ALTER TABLE public.procedures RENAME COLUMN content       TO contenido_texto;
ALTER TABLE public.procedures RENAME COLUMN storage_path  TO file_path;
ALTER TABLE public.procedures RENAME COLUMN category      TO categoria;

-- ============================================================
-- 2. ENUM Y COLUMNA DE ESTADO (delta §2)
-- ============================================================

CREATE TYPE public.procedure_estado AS ENUM ('vigente', 'archivado');

ALTER TABLE public.procedures
  ADD COLUMN estado public.procedure_estado NOT NULL DEFAULT 'vigente';

-- ============================================================
-- 3. CHECK DE CONTENIDO (delta §3)
-- Al menos uno de contenido_texto o file_path, con el MISMO criterio de
-- "presente" para los dos: no NULL y no blanco (solo espacios). Antes del
-- fix de FB-F5-AUD-02 Hallazgo 1, la rama de file_path solo pedía
-- IS NOT NULL (asimétrica con contenido_texto), así que un file_path=''
-- pasaba el CHECK sin contenido real.
-- ============================================================

ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_contenido_presente
  CHECK (
    (contenido_texto IS NOT NULL AND btrim(contenido_texto) <> '')
    OR (file_path IS NOT NULL AND btrim(file_path) <> '')
  );

-- ============================================================
-- 4. RLS DE `procedures` — reemplazo de la policy de SELECT (delta §4)
-- procedures_write_admin (INSERT/UPDATE/DELETE, is_admin()) no cambia.
-- ============================================================

DROP POLICY IF EXISTS "procedures_select_all" ON public.procedures;

-- Una sola policy: admin ve todo (incluidos archivados); no-admin
-- (supervisor/empleado) solo ve vigentes. Los procedimientos son de la
-- empresa, sin lógica de equipo — supervisor y empleado leen lo mismo.
CREATE POLICY "procedures_select" ON public.procedures
  FOR SELECT USING (
    (SELECT public.is_admin())
    OR estado = 'vigente'
  );

-- ============================================================
-- 5. RPCs DE PROCEDIMIENTOS (delta §5) — SECURITY DEFINER, patrón §6.1
-- Cada una escribe procedures + audit_log (vía log_audit) en una sola
-- transacción: PERFORM no abre transacción propia, corre en la del
-- llamador — un fallo en cualquier punto revierte todo.
-- ============================================================

-- ─── RPC: crear_procedimiento ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_procedimiento(
  p_titulo           TEXT,
  p_categoria        TEXT,
  p_contenido_texto  TEXT,
  p_file_path        TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- auth.uid() IS NULL se chequea explícito: is_admin() da NULL (no false)
  -- sin sesión, y `IF NOT NULL` no dispara el RAISE en plpgsql.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede crear un procedimiento'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.procedures
    (titulo, categoria, contenido_texto, file_path, created_by, updated_by)
  VALUES
    (p_titulo, p_categoria, p_contenido_texto, p_file_path, auth.uid(), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.log_audit(
    'procedimiento_creado',
    'procedures',
    v_id,
    NULL,
    jsonb_build_object(
      'titulo', p_titulo,
      'categoria', p_categoria,
      'contenido_texto', p_contenido_texto,
      'file_path', p_file_path,
      'estado', 'vigente'
    )
  );

  RETURN v_id;
END;
$$;

-- ─── RPC: actualizar_procedimiento ───────────────────────────────
CREATE OR REPLACE FUNCTION public.actualizar_procedimiento(
  p_id                UUID,
  p_titulo            TEXT,
  p_categoria         TEXT,
  p_contenido_texto   TEXT,
  p_file_path         TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_procedure public.procedures%ROWTYPE;
  v_old_data  JSONB;
  v_new_data  JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede actualizar un procedimiento'
      USING ERRCODE = '42501';
  END IF;

  -- Bloqueo de fila: serializa actualizaciones concurrentes del mismo
  -- procedimiento y fija el old_data leído para audit_log.
  SELECT * INTO v_procedure
  FROM public.procedures
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El procedimiento % no existe', p_id USING ERRCODE = 'P0002';
  END IF;

  v_old_data := jsonb_build_object(
    'titulo', v_procedure.titulo,
    'categoria', v_procedure.categoria,
    'contenido_texto', v_procedure.contenido_texto,
    'file_path', v_procedure.file_path
  );

  UPDATE public.procedures
  SET titulo           = p_titulo,
      categoria        = p_categoria,
      contenido_texto  = p_contenido_texto,
      file_path        = p_file_path,
      updated_by       = auth.uid(),
      updated_at       = now()
  WHERE id = p_id;

  v_new_data := jsonb_build_object(
    'titulo', p_titulo,
    'categoria', p_categoria,
    'contenido_texto', p_contenido_texto,
    'file_path', p_file_path
  );

  PERFORM public.log_audit('procedimiento_actualizado', 'procedures', p_id, v_old_data, v_new_data);
END;
$$;

-- ─── RPC: archivar_procedimiento ─────────────────────────────────
-- Mueve entre 'vigente' y 'archivado' en cualquier dirección (reversible).
-- La acción de audit_log distingue el sentido del movimiento.
CREATE OR REPLACE FUNCTION public.archivar_procedimiento(
  p_id      UUID,
  p_estado  public.procedure_estado
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_procedure public.procedures%ROWTYPE;
  v_action    TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede archivar o restaurar un procedimiento'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_procedure
  FROM public.procedures
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El procedimiento % no existe', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.procedures
  SET estado     = p_estado,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_id;

  v_action := CASE p_estado
    WHEN 'archivado' THEN 'procedimiento_archivado'
    ELSE 'procedimiento_restaurado'
  END;

  PERFORM public.log_audit(
    v_action,
    'procedures',
    p_id,
    jsonb_build_object('estado', v_procedure.estado),
    jsonb_build_object('estado', p_estado)
  );
END;
$$;

-- ─── Grants: solo `authenticated` puede ejecutar, nunca anon/PUBLIC ──────
-- (re-aseverados dentro de este mismo CREATE, mismo molde que 0016/0018/0019)
REVOKE ALL ON FUNCTION public.crear_procedimiento(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_procedimiento(TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_procedimiento(TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.actualizar_procedimiento(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.actualizar_procedimiento(UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.actualizar_procedimiento(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.archivar_procedimiento(UUID, public.procedure_estado) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archivar_procedimiento(UUID, public.procedure_estado) FROM anon;
GRANT EXECUTE ON FUNCTION public.archivar_procedimiento(UUID, public.procedure_estado) TO authenticated;

-- ============================================================
-- 6. CIERRE DE `log_audit()` (delta §6)
-- Hoy es invocable vía REST por anon/authenticated (el REVOKE FROM PUBLIC
-- de 0001 no alcanzó a esos dos roles: Supabase les otorga EXECUTE por
-- default privileges explícitos, no vía PUBLIC). No se toca el cuerpo ni
-- se le agrega guarda: sigue siendo un helper interno para SECURITY
-- DEFINER futuros (incluidos los tres de arriba), que la ejecutan como su
-- OWNER (postgres) y no se ven afectados por este REVOKE.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.log_audit(TEXT, TEXT, UUID, JSONB, JSONB) FROM anon, authenticated, PUBLIC;

-- ============================================================
-- 7. BUCKET DE STORAGE PARA PROCEDIMIENTOS (delta §7)
-- Privado, sin {userId}: un procedimiento no tiene dueño individual.
-- Path acordado para FB-F5-03: {procedure_id}/{filename} — el primer
-- segmento es el UUID del procedimiento (no un profile id), así que las
-- policies de abajo no replican la lógica de storage.foldername() de
-- 'documents'; el control de acceso es por bucket + rol, no por path.
-- MIME/tamaño: mismo límite que 'documents' (lib/storage.ts,
-- MAX_FILE_SIZE_BYTES = 10 MB), MIME ampliado a PDF/Word/texto plano
-- (el PRD pide .txt, que 'documents' no acepta).
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'procedimientos',
  'procedimientos',
  false,
  10485760,  -- 10 MB, igual que 'documents'
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- SELECT: cualquier autenticado. El ocultamiento de archivados vive en la
-- RLS de `procedures` (§4), no acá — Storage no sabe qué fila de
-- `procedures` referencia cada objeto, y duplicar ese criterio en dos
-- capas sería una fuente de drift entre ambas.
CREATE POLICY "storage_procedimientos_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'procedimientos'
    AND auth.uid() IS NOT NULL
  );

-- INSERT/UPDATE/DELETE: solo admin — mismo autor que puede escribir en
-- `procedures` (procedures_write_admin).
CREATE POLICY "storage_procedimientos_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'procedimientos'
    AND (SELECT public.is_admin())
  );

CREATE POLICY "storage_procedimientos_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'procedimientos'
    AND (SELECT public.is_admin())
  )
  WITH CHECK (
    bucket_id = 'procedimientos'
    AND (SELECT public.is_admin())
  );

CREATE POLICY "storage_procedimientos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'procedimientos'
    AND (SELECT public.is_admin())
  );

-- ============================================================
-- 8. `profiles` — BAJA CON MOTIVO Y FECHA (delta §8)
-- Nullable a nivel base: obligatorias AL INACTIVAR, no en cualquier fila
-- (un usuario activo no tiene motivo de baja). La obligatoriedad la impone
-- la Server Action de FB-F5-04, no un CHECK acá — un CHECK ligado a
-- `status = 'inactivo'` acoplaría esta migración a una regla de UI que
-- puede afinarse sin volver a tocar el esquema. Sin backfill: no hay
-- usuarios inactivos reales hoy (FB-F5-01-INSPECT-REPORT.md, bloque D).
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN motivo_baja TEXT;
ALTER TABLE public.profiles ADD COLUMN fecha_baja DATE;
