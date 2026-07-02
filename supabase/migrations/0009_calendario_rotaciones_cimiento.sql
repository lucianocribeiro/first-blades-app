-- 0009_calendario_rotaciones_cimiento.sql
-- FB-F3-01: cimiento de datos del Calendario de Rotaciones.
--
-- Inventario previo (ver PR): rotation_assignments YA es per-día
-- (columnas user_id, fecha, estado_dia, UNIQUE(user_id, fecha)) desde
-- 0001_init.sql — no existe el modelo de rango fecha_inicio/fecha_fin que
-- el prompt anticipaba, así que no hay migración destructiva que hacer.
-- profiles.dni YA existe (nullable TEXT) desde 0001_init.sql, sin UNIQUE.
-- rotation_group_id (nombre real de "group_id") ya es nullable con FK a
-- rotation_groups. La RLS de rotation_assignments en 0001_init.sql ya
-- coincide exactamente con la constitución §6 (admin completo;
-- supervisor+empleado solo SELECT con scope de equipo; sin escritura
-- no-admin) — no requiere ajuste. La RLS de rotation_groups SÍ se ajusta
-- (ver punto 5 abajo): 0001_init.sql tenía una policy de SELECT abierta a
-- cualquier autenticado que no coincidía con la constitución.
--
-- Delta real de esta migración:
--   1. rotation_assignments.es_estimado (estimado vs. real; PRD Fase 3 #2)
--   2. rotation_assignments.motivo_otros_texto (PRD Fase 3 #4, constitución §5)
--   3. CHECK: periodo_fuera_trabajo exige motivo_ausencia (PRD Fase 3 #4)
--   4. profiles.dni UNIQUE (clave de import de historial, PRD Fase 3 #8)
--   5. rotation_groups: RLS admin-only (FB-F3-AUD-01 Hallazgo 3 — tabla
--      inerte en Fase 3, sin UI ni consumidor; decisión de Luciano)

-- ─── rotation_assignments: es_estimado ────────────────────────────────────
-- true = día futuro planificado (estimado); false = real. Un cron posterior
-- (otra tarea) lo pasa a false cuando fecha <= hoy + 7 días.
ALTER TABLE public.rotation_assignments
  ADD COLUMN IF NOT EXISTS es_estimado BOOLEAN NOT NULL DEFAULT false;

-- ─── rotation_assignments: motivo_otros_texto ─────────────────────────────
-- Texto libre cuando motivo_ausencia = 'otros' (mismo patrón que
-- documents.certificado_otros_texto de 0002_fase1_perfil.sql).
ALTER TABLE public.rotation_assignments
  ADD COLUMN IF NOT EXISTS motivo_otros_texto VARCHAR(80);

-- ─── rotation_assignments: motivo obligatorio en periodo_fuera_trabajo ────
-- Constraint a nivel de base (no solo en la app): un día periodo_fuera_trabajo
-- SIEMPRE debe tener motivo_ausencia.
ALTER TABLE public.rotation_assignments
  ADD CONSTRAINT rotation_assignments_motivo_requerido
  CHECK (estado_dia <> 'periodo_fuera_trabajo' OR motivo_ausencia IS NOT NULL);

-- ─── profiles: dni único (clave de import de historial) ───────────────────
-- Nullable: Postgres permite múltiples NULL bajo UNIQUE. El admin completa
-- el DNI de los empleados actuales; no se agrega NOT NULL.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_dni_unique UNIQUE (dni);

-- ─── rotation_groups: RLS admin-only (FB-F3-AUD-01 Hallazgo 3) ────────────
-- 0001_init.sql dejó "rotation_groups_select_all" con SELECT abierto a
-- cualquier autenticado, sin distinción de rol. En Fase 3 rotation_groups
-- es una tabla inerte (group_id nullable, sin UI ni consumidor de grupos),
-- así que se restringe a admin-only: se retira el SELECT amplio y queda
-- únicamente "rotation_groups_admin" (FOR ALL, admin), que ya cubre
-- SELECT/INSERT/UPDATE/DELETE para admin y deniega todo a no-admin por
-- ausencia de policy.
DROP POLICY IF EXISTS "rotation_groups_select_all" ON public.rotation_groups;
