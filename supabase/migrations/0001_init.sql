-- ============================================================
-- First Blades Portal — Migración inicial
-- Enums, tablas base, triggers, RLS y Storage
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE employee_status AS ENUM ('activo', 'inactivo', 'pendiente');
CREATE TYPE approval_status AS ENUM ('pendiente', 'aprobado', 'rechazado');
CREATE TYPE user_role AS ENUM ('admin', 'supervisor', 'empleado');
CREATE TYPE estado_dia AS ENUM ('trabajando', 'en_viaje', 'en_franco', 'periodo_fuera_trabajo');
CREATE TYPE motivo_ausencia AS ENUM (
  'vacaciones', 'licencia_medica', 'dia_tramite',
  'matrimonio', 'fallecimiento', 'otros'
);
CREATE TYPE motivo_viaje AS ENUM ('inicio_franco', 'fin_franco', 'traslado_proyectos');

-- ============================================================
-- TABLAS
-- (profiles primero: otras tablas y funciones dependen de ella)
-- ============================================================

-- profiles — espeja auth.users
CREATE TABLE public.profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  full_name      TEXT,
  role           user_role        NOT NULL DEFAULT 'empleado',
  status         employee_status  NOT NULL DEFAULT 'activo',
  supervisor_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone          TEXT,
  dni            TEXT,
  fecha_ingreso  DATE,
  entrevista_tecnica JSONB,          -- solo visible para admin (RLS)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- documents — purgatorio de archivos
CREATE TABLE public.documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type  TEXT NOT NULL,
  filename       TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  file_size      INTEGER,
  mime_type      TEXT,
  estado         approval_status NOT NULL DEFAULT 'pendiente',
  motivo_rechazo TEXT,
  uploaded_by    UUID NOT NULL REFERENCES public.profiles(id),
  reviewed_by    UUID REFERENCES public.profiles(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pasaje_requests
CREATE TABLE public.pasaje_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  empleado_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  motivo_viaje   motivo_viaje NOT NULL,
  fecha_viaje    DATE NOT NULL,
  origen         TEXT NOT NULL,
  destino        TEXT NOT NULL,
  notas          TEXT,
  estado         approval_status NOT NULL DEFAULT 'pendiente',
  motivo_rechazo TEXT,
  reviewed_by    UUID REFERENCES public.profiles(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ausencia_requests
CREATE TABLE public.ausencia_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  motivo_ausencia motivo_ausencia NOT NULL,
  fecha_inicio   DATE NOT NULL,
  fecha_fin      DATE NOT NULL,
  notas          TEXT,
  estado         approval_status NOT NULL DEFAULT 'pendiente',
  motivo_rechazo TEXT,
  reviewed_by    UUID REFERENCES public.profiles(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rotation_groups
CREATE TABLE public.rotation_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  descripcion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rotation_assignments
CREATE TABLE public.rotation_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rotation_group_id UUID REFERENCES public.rotation_groups(id) ON DELETE SET NULL,
  fecha             DATE NOT NULL,
  estado_dia        estado_dia NOT NULL DEFAULT 'trabajando',
  motivo_ausencia   motivo_ausencia,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fecha)
);

-- procedures / políticas
CREATE TABLE public.procedures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  content      TEXT,
  storage_path TEXT,
  category     TEXT,
  created_by   UUID NOT NULL REFERENCES public.profiles(id),
  updated_by   UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit_log — registro inmutable de transiciones de estado
CREATE TABLE public.audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   UUID NOT NULL,
  old_data    JSONB,
  new_data    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- HELPERS DE ROL (SECURITY DEFINER para RLS performant)
-- Deben ir después de crear public.profiles (LANGUAGE sql valida
-- referencias a tablas al momento de crear la función).
-- ============================================================

CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT public.auth_role()) = 'admin'
$$;

-- ============================================================
-- TRIGGER: crear perfil al registrar usuario en auth
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCIÓN: registrar en audit_log (uso interno/SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_audit(
  p_action      TEXT,
  p_table_name  TEXT,
  p_record_id   UUID,
  p_old_data    JSONB DEFAULT NULL,
  p_new_data    JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (auth.uid(), p_action, p_table_name, p_record_id, p_old_data, p_new_data);
END;
$$;

-- SECURITY: revocar ejecución pública de log_audit y otorgar solo a service_role.
-- Los server actions de aprobación usan el cliente admin (service_role_key) para invocarla.
-- El rol authenticated nunca puede llamarla directamente desde el cliente.
REVOKE EXECUTE ON FUNCTION public.log_audit(TEXT, TEXT, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_audit(TEXT, TEXT, UUID, JSONB, JSONB) TO service_role;

-- ============================================================
-- RLS — activar en TODAS las tablas
-- ============================================================

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasaje_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ausencia_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLÍTICAS: profiles
-- ============================================================

-- SELECT: cada uno ve su fila; supervisor ve su equipo; admin ve todo
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR (SELECT public.auth_role()) = 'admin'
    OR (
      (SELECT public.auth_role()) = 'supervisor'
      AND supervisor_id = auth.uid()
    )
  );

-- La columna entrevista_tecnica solo admin puede leerla: se maneja a nivel de app
-- (la RLS no puede filtrar columnas; la app no la expone a no-admin)

-- UPDATE: solo admin
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- INSERT: el trigger crea perfiles (SECURITY DEFINER), no se permite INSERT directo
-- admin sí puede insertar via service_role (bypass RLS)

-- DELETE: solo admin
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE USING ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: documents
-- ============================================================

CREATE POLICY "documents_select" ON public.documents
  FOR SELECT USING (
    (SELECT public.is_admin())
    OR user_id = auth.uid()
    OR (
      (SELECT public.auth_role()) = 'supervisor'
      AND user_id IN (
        SELECT id FROM public.profiles WHERE supervisor_id = auth.uid()
      )
    )
  );

-- INSERT: usuario sube sus propios docs; estado forzado a 'pendiente'
CREATE POLICY "documents_insert_own" ON public.documents
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND uploaded_by = auth.uid()
    AND estado = 'pendiente'
  );

-- Admin puede insertar para cualquiera
CREATE POLICY "documents_insert_admin" ON public.documents
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

-- UPDATE: solo admin puede cambiar estado (aprobar/rechazar)
CREATE POLICY "documents_update_admin" ON public.documents
  FOR UPDATE USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- DELETE: solo admin
CREATE POLICY "documents_delete_admin" ON public.documents
  FOR DELETE USING ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: pasaje_requests
-- ============================================================

CREATE POLICY "pasajes_select" ON public.pasaje_requests
  FOR SELECT USING (
    (SELECT public.is_admin())
    OR solicitante_id = auth.uid()
    OR empleado_id = auth.uid()
    OR (
      (SELECT public.auth_role()) = 'supervisor'
      AND (
        solicitante_id IN (SELECT id FROM public.profiles WHERE supervisor_id = auth.uid())
        OR empleado_id IN (SELECT id FROM public.profiles WHERE supervisor_id = auth.uid())
      )
    )
  );

-- INSERT empleado: solo para sí mismo
CREATE POLICY "pasajes_insert_empleado" ON public.pasaje_requests
  FOR INSERT WITH CHECK (
    (SELECT public.auth_role()) = 'empleado'
    AND solicitante_id = auth.uid()
    AND empleado_id = auth.uid()
    AND estado = 'pendiente'
  );

-- INSERT supervisor: para sí o su equipo
CREATE POLICY "pasajes_insert_supervisor" ON public.pasaje_requests
  FOR INSERT WITH CHECK (
    (SELECT public.auth_role()) = 'supervisor'
    AND solicitante_id = auth.uid()
    AND estado = 'pendiente'
    AND (
      empleado_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = empleado_id AND supervisor_id = auth.uid()
      )
    )
  );

-- INSERT admin: cualquiera
CREATE POLICY "pasajes_insert_admin" ON public.pasaje_requests
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

-- UPDATE: solo admin (para aprobar/rechazar)
CREATE POLICY "pasajes_update_admin" ON public.pasaje_requests
  FOR UPDATE USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- DELETE: solo admin
CREATE POLICY "pasajes_delete_admin" ON public.pasaje_requests
  FOR DELETE USING ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: ausencia_requests
-- ============================================================

CREATE POLICY "ausencias_select" ON public.ausencia_requests
  FOR SELECT USING (
    (SELECT public.is_admin())
    OR user_id = auth.uid()
    OR (
      (SELECT public.auth_role()) = 'supervisor'
      AND user_id IN (SELECT id FROM public.profiles WHERE supervisor_id = auth.uid())
    )
  );

CREATE POLICY "ausencias_insert_non_admin" ON public.ausencia_requests
  FOR INSERT WITH CHECK (
    NOT (SELECT public.is_admin())
    AND user_id = auth.uid()
    AND estado = 'pendiente'
  );

CREATE POLICY "ausencias_insert_admin" ON public.ausencia_requests
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "ausencias_update_admin" ON public.ausencia_requests
  FOR UPDATE USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "ausencias_delete_admin" ON public.ausencia_requests
  FOR DELETE USING ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: rotation_groups
-- ============================================================

CREATE POLICY "rotation_groups_select_all" ON public.rotation_groups
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "rotation_groups_admin" ON public.rotation_groups
  FOR ALL USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: rotation_assignments
-- ============================================================

CREATE POLICY "rotation_assign_select" ON public.rotation_assignments
  FOR SELECT USING (
    (SELECT public.is_admin())
    OR user_id = auth.uid()
    OR (
      (SELECT public.auth_role()) = 'supervisor'
      AND user_id IN (SELECT id FROM public.profiles WHERE supervisor_id = auth.uid())
    )
  );

CREATE POLICY "rotation_assign_write_admin" ON public.rotation_assignments
  FOR ALL USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: procedures
-- ============================================================

CREATE POLICY "procedures_select_all" ON public.procedures
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "procedures_write_admin" ON public.procedures
  FOR ALL USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ============================================================
-- POLÍTICAS: audit_log
-- ============================================================

CREATE POLICY "audit_log_select_admin" ON public.audit_log
  FOR SELECT USING ((SELECT public.is_admin()));

-- Los inserts van únicamente por la función log_audit (SECURITY DEFINER)
-- No se permite INSERT directo desde el cliente

-- ============================================================
-- STORAGE: bucket de documentos
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  10485760,  -- 10 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Política Storage: usuarios suben a su propia carpeta ({user_id}/filename)
CREATE POLICY "storage_documents_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Política Storage: usuarios leen sus propios archivos; admin lee todos
CREATE POLICY "storage_documents_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (SELECT public.is_admin())
      OR (
        (SELECT public.auth_role()) = 'supervisor'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.profiles WHERE supervisor_id = auth.uid()
        )
      )
    )
  );

-- Política Storage: solo admin puede eliminar
CREATE POLICY "storage_documents_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documents'
    AND (SELECT public.is_admin())
  );
