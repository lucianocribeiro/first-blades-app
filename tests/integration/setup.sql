-- ============================================================
-- Setup de base de datos para tests de integración RLS
-- Se ejecuta antes de aplicar la migración principal.
-- Simula el entorno mínimo de Supabase sin su stack completo.
-- ============================================================

-- ─── Esquema auth (mock mínimo de Supabase Auth) ─────────────

CREATE SCHEMA IF NOT EXISTS auth;

-- Tabla auth.users: necesaria para la FK de profiles
CREATE TABLE IF NOT EXISTS auth.users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT,
  raw_user_meta_data  JSONB DEFAULT '{}'
);

-- auth.uid(): lee el claim 'sub' del JWT simulado en la sesión
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true), ''
  )::jsonb ->> 'sub'
$$;

-- ─── Esquema storage (mock mínimo para las policies de Storage) ─

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 TEXT PRIMARY KEY,
  name               TEXT,
  public             BOOLEAN DEFAULT false,
  file_size_limit    BIGINT,
  allowed_mime_types TEXT[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  TEXT,
  name       TEXT,
  owner      UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- storage.foldername: devuelve los componentes de la ruta
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql
AS $$
  SELECT string_to_array(name, '/')
$$;

-- ─── Roles de Supabase ────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role BYPASSRLS;
  END IF;
END;
$$;
