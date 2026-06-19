-- 0004_rls_fixes.sql — Remediación FB-F1-AUD-01
-- Hallazgos corregidos:
--   #01 Supervisor: restricción de visibilidad en documents y storage (solo propio)
--   #04 Storage INSERT: permitir al admin subir a la carpeta de cualquier empleado

-- ─── storage.objects: habilitar RLS explícitamente ───────────────────────────
-- En Supabase real ya viene habilitado; se deja explícito para alinear la
-- migración con el mock de tests (setup.sql) y cumplir el DoD de auditoría.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ─── documents_select: Supervisor solo ve sus propios documentos ─────────────
-- (Supervisor mantiene SELECT de profiles de su equipo vía policy profiles_select,
--  pero no puede leer los documentos de sus subordinados desde esta tabla.)

DROP POLICY IF EXISTS "documents_select" ON public.documents;

CREATE POLICY "documents_select" ON public.documents
  FOR SELECT USING (
    (SELECT public.is_admin())
    OR user_id = auth.uid()
  );

-- ─── storage_documents_select: Supervisor solo ve sus propios archivos ───────

DROP POLICY IF EXISTS "storage_documents_select" ON storage.objects;

CREATE POLICY "storage_documents_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (SELECT public.is_admin())
    )
  );

-- ─── storage_documents_insert: Admin puede subir a cualquier carpeta ─────────
-- Necesario para que el admin cargue documentos (ej. estudio médico)
-- en nombre de un empleado usando el cliente autenticado como admin.

DROP POLICY IF EXISTS "storage_documents_insert" ON storage.objects;

CREATE POLICY "storage_documents_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (SELECT public.is_admin())
    )
  );
