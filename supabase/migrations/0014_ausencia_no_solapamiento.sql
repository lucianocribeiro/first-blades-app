-- 0014_ausencia_no_solapamiento.sql
-- FB-F4-01: no-solapamiento de rangos entre ausencias PENDIENTES del mismo
-- empleado (cualquier motivo). Reemplaza el índice único parcial de 0012
-- (que solo bloqueaba duplicados exactos de motivo+fechas) por una
-- exclusion constraint de rangos: dos pendientes del mismo user_id no
-- pueden compartir ni un solo día, sin importar el motivo. Contra
-- aprobadas NO bloquea (una aprobada puede sobrescribir días ya escritos;
-- la alerta de sobrescritura es de la pieza de feature, FB-F4-02).
--
-- Inspección previa (delta-only, MCP Supabase, ruta sancionada, ref
-- simfemdkrkdbumefcxei, solo lectura): columna de empleado es user_id uuid
-- NOT NULL (no profile_id); fecha_inicio/fecha_fin son date NOT NULL;
-- índice viejo confirmado verbatim vía pg_indexes: CREATE UNIQUE INDEX
-- ausencia_requests_pendiente_unica ON public.ausencia_requests USING
-- btree (user_id, motivo_ausencia, fecha_inicio, fecha_fin) WHERE (estado
-- = 'pendiente'::approval_status); btree_gist no está instalada
-- (installed_version null); las extensiones existentes (pgcrypto,
-- pg_stat_statements, uuid-ossp) viven en schema `extensions` por
-- convención Supabase, mismo schema usado acá; Local = Remote en 0013
-- antes de numerar esta migración; preflight de lectura no encontró
-- ninguna fila pendiente en solapamiento en prod.

-- 1) btree_gist habilita el operador de igualdad (=) dentro de un índice
--    GIST, necesario para combinar user_id (=) con el solapamiento de
--    rangos (&&) en una sola exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- 2) Drop del índice viejo (0012): solo bloqueaba duplicados exactos de
--    motivo+fechas (mismo motivo, mismas fechas exactas). No bloqueaba
--    solapamientos parciales ni motivos distintos con rangos solapados.
DROP INDEX IF EXISTS public.ausencia_requests_pendiente_unica;

-- 3) Exclusion constraint: dos filas PENDIENTES del mismo user_id no
--    pueden tener rangos [fecha_inicio, fecha_fin] que se solapen, sin
--    importar motivo_ausencia. Rango inclusivo en ambos extremos ('[]'):
--    compartir un solo día ya es solapamiento (ej. una termina el día 5,
--    otra empieza el día 5). El predicado WHERE limita el bloqueo a
--    pendiente-contra-pendiente: una aprobada no impide una nueva
--    pendiente que se solape con ella.
ALTER TABLE public.ausencia_requests
  ADD CONSTRAINT ausencia_requests_no_solapamiento_pendiente
  EXCLUDE USING gist (
    user_id WITH =,
    daterange(fecha_inicio, fecha_fin, '[]') WITH &&
  )
  WHERE (estado = 'pendiente');
