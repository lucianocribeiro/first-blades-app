-- 0006_documents_rechazo_motivo_obligatorio.sql
-- M2 (FB-F1-AUD-04): un documento rechazado debe tener motivo no vacío.
-- Cierra el vector: por API directa no se puede dejar estado='rechazado' sin motivo.
ALTER TABLE public.documents
  ADD CONSTRAINT documents_rechazo_requiere_motivo
  CHECK (
    estado <> 'rechazado'
    OR (motivo_rechazo IS NOT NULL AND btrim(motivo_rechazo) <> '')
  );
