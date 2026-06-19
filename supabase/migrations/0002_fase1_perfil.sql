-- ============================================================
-- First Blades Portal — Migración Fase 1: Mi Perfil
-- Agrega campos faltantes en profiles, nuevo enum certificado_tipo
-- y columnas nuevas en documents.
--
-- Paso 1 y Paso 2 del prompt FB-F1-01:
--   - profiles: nombre, apellido, cuit, winda_id
--   - CREATE TYPE certificado_tipo (6 valores, CREATE fresco = sin límites de transacción)
--   - documents: certificado_tipo, certificado_otros_texto, fecha_vencimiento
-- ============================================================

-- ─── profiles: campos faltantes del modelo de datos (Constitución §5) ──

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nombre    TEXT,
  ADD COLUMN IF NOT EXISTS apellido  TEXT,
  ADD COLUMN IF NOT EXISTS cuit      TEXT,
  ADD COLUMN IF NOT EXISTS winda_id  TEXT;

-- ─── Enum certificado_tipo ────────────────────────────────────────────────
-- 6 valores definitivos (CREATE TYPE fresco: se puede usar en la misma transacción).
-- Los labels de UI viven en /lib/copy.

CREATE TYPE public.certificado_tipo AS ENUM (
  'gwo',
  'cursos_elevadores',
  'espacio_confinado',
  'manejo_defensivo',
  'cursos_vestas',
  'otros'
);

-- ─── documents: columnas nuevas para carga de documentos Fase 1 ──────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS certificado_tipo        public.certificado_tipo,
  ADD COLUMN IF NOT EXISTS certificado_otros_texto VARCHAR(80),
  ADD COLUMN IF NOT EXISTS fecha_vencimiento       DATE;
