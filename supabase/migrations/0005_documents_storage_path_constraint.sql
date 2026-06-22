-- 0005_documents_storage_path_constraint.sql
-- A2 (FB-F1-AUD-04): storage_path debe pertenecer a la carpeta del user_id del documento.
-- Cierra el vector: un usuario no puede insertar una fila propia apuntando a un path ajeno.
-- storage_path es NOT NULL (definido en 0001_init.sql), sin rama IS NULL.
ALTER TABLE public.documents
  ADD CONSTRAINT documents_storage_path_matches_user
  CHECK (storage_path LIKE user_id::text || '/%');
