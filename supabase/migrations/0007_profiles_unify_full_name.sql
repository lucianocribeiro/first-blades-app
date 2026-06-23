-- 0007_profiles_unify_full_name.sql
-- Opción 1 (FB-F1-AUD-06): nombre único en full_name; se retiran nombre/apellido.
-- IF EXISTS porque el Supabase remoto nunca tuvo esas columnas (drift previo documentado).
ALTER TABLE public.profiles DROP COLUMN IF EXISTS nombre;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS apellido;
