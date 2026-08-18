-- 0021_employee_status_sin_pendiente.sql
-- FB-ADJ-03: el módulo "Ingreso" (precarga de candidatos sin cuenta) se
-- descarta antes de construirse. Era el único caso de uso previsto para el
-- valor `pendiente` de `employee_status`; sin módulo, el valor queda muerto
-- y se elimina del enum en lugar de dejarlo sin uso.
--
-- Base real reportada en docs/prompts/FB-ADJ-03-INSPECT-REPORT.md
-- (inspección en vivo, proyecto simfemdkrkdbumefcxei, 2026-08-18):
--   - employee_status: activo (1), inactivo (2), pendiente (3).
--   - profiles.status: NOT NULL DEFAULT 'activo'.
--   - 0 filas de profiles en 'pendiente' (3 filas, las 3 en 'activo').
--   - pg_depend sobre el tipo: solo 3 dependencias, las 3 estructurales
--     (la columna, su default, y el array-type implícito del enum). Sin
--     policies, funciones SECURITY DEFINER, vistas, índices ni CHECK
--     constraints que referencien el tipo o sus valores.
--
-- Postgres no permite ALTER TYPE ... DROP VALUE: hay que recrear el tipo.
-- Como no hay ninguna dependencia de negocio que recrear (solo la columna
-- y su default), el delta es mínimo.

CREATE TYPE employee_status_new AS ENUM ('activo', 'inactivo');

ALTER TABLE public.profiles
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.profiles
  ALTER COLUMN status TYPE employee_status_new
  USING status::text::employee_status_new;

ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'activo'::employee_status_new;

DROP TYPE employee_status;

ALTER TYPE employee_status_new RENAME TO employee_status;
