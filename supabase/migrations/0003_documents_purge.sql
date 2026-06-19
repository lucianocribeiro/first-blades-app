-- 0003_documents_purge.sql
-- Agrega soporte para purga automática del archivo físico de documentos rechazados.
-- Solo se borra el archivo de Storage; el row de documents se conserva siempre.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS file_purged_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.documents.file_purged_at
  IS 'Timestamp en que el archivo físico fue eliminado de Storage por retención (30 días). NULL = archivo disponible.';
