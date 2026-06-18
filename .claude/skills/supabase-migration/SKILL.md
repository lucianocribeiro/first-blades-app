---
name: supabase-migration
description: >
  Crear y modificar el esquema de Supabase del Portal First Blades mediante
  migraciones versionadas: enums, tablas, políticas RLS por rol (admin /
  supervisor / empleado, con lógica de equipo por supervisor_id), buckets de
  Storage con signed URLs, y regeneración de tipos TypeScript. Usar SIEMPRE que
  haya que tocar el esquema, agregar una tabla/columna, o escribir o ajustar RLS.
---

# Skill: supabase-migration

Toda mutación de esquema va por una migración versionada en
`/supabase/migrations`. Nada de cambios manuales en el dashboard que no queden
en una migración. Después de cada migración, **regenerá y commiteá** los tipos TS.

## Convenciones

- Un archivo por cambio, prefijo ordinal/timestamp (`0001_init.sql`, `0002_...`).
- SQL explícito y reversible cuando sea posible. Comentá el propósito arriba.
- Sin datos sensibles ni secretos en las migraciones. El email del primer admin
  entra por seed leyendo una **variable de entorno**, no hardcodeado.

## Enums (constitución §5)

- `employee_status`: `activo | inactivo | pendiente`
- `approval_status`: `pendiente | aprobado | rechazado`
- `user_role`: `admin | supervisor | empleado`
- `estado_dia`: `trabajando | en_viaje | en_franco | periodo_fuera_trabajo`
- `motivo_ausencia`: `vacaciones | licencia_medica | dia_tramite | matrimonio | fallecimiento | otros`
- `motivo_viaje`: `inicio_franco | fin_franco | traslado_proyectos`

## Tablas base

`profiles` (con `supervisor_id` FK a profiles, nullable; `entrevista_tecnica` jsonb solo-admin), `documents` (purgatorio unificado de archivos), `pasaje_requests` (`solicitante_id` + `empleado_id` + `motivo_viaje`), `ausencia_requests`, `rotation_groups`, `rotation_assignments` (`estado_dia` + `motivo_ausencia`), `procedures`, `audit_log`. Detalle de columnas en la constitución §5.

## RLS (constitución §6) — la autoridad

**Activá RLS en TODAS las tablas.** Patrones por rol:

- Helpers recomendados: una función `auth_role()` que lea el rol del `profile`
  del `auth.uid()`, y `is_admin()`. El chequeo de equipo del supervisor compara
  `profiles.supervisor_id = auth.uid()`.
- `profiles`: empleado/supervisor `SELECT` su fila; supervisor además `SELECT`
  las filas con `supervisor_id = auth.uid()`; **sin `UPDATE`** para no-admin;
  admin completo.
- `documents` / `pasaje_requests` / `ausencia_requests`: el solicitante
  `INSERT`/`SELECT` lo propio; en pasajes el supervisor además para/de su equipo.
  En `INSERT`, el estado se fuerza a `pendiente` (no se puede setear `aprobado`);
  no-admin no puede cambiar `estado`. Admin completo (aprobar).
- `rotation_*`: empleado `SELECT` su calendario; supervisor `SELECT` su
  calendario + el de su equipo; **sin escritura** para no-admin; admin completo.
- `procedures`: empleado/supervisor solo `SELECT`; admin completo.

Cada política se acompaña de un **test de RLS por tabla y por rol** (ver
`new-module` y `dod-checklist`).

## Storage

- Bucket(s) de documentos con políticas de acceso por dueño/rol.
- Acceso a archivos siempre por **signed URLs** (no URLs públicas).
- Validá tipo/tamaño de archivo al subir.

## Tipos TypeScript

- Tras aplicar migraciones, regenerá los tipos (`supabase gen types ...`) y
  **commiteá** el archivo. El código consume esos tipos; no escribas tipos a mano
  para tablas existentes.

## Checklist de la migración

- [ ] RLS activada en cada tabla nueva.
- [ ] Políticas para los 3 roles (+ lógica de equipo del supervisor).
- [ ] `estado` forzado a `pendiente` en inserts de no-admin donde aplique.
- [ ] Storage con signed URLs y validación.
- [ ] Tipos TS regenerados y commiteados.
- [ ] Migración aplica limpio desde cero.
