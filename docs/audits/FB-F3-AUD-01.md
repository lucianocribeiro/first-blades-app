# FB-F3-AUD-01 — Auditoría: Cimiento de datos del Calendario de Rotaciones

Fecha: 2026-07-02  
Rama auditada: `feat/fb-f3-01-calendario-rotaciones-cimiento` (`606ba44`)  
Alcance: migración `0009`, RLS `rotation_*`, tests de integración, drift detector, `supabase/types.ts`, delta de `profiles.dni`.

## Resumen ejecutivo

**Veredicto:** requiere fix previo al push.

Bloqueantes:
- El historial remoto tiene una migración `0008` que no existe en el repo local; `0009` todavía no fue aplicada a remoto.
- Los tests RLS de `rotation_*` no cubren `UPDATE`/`DELETE` denegado para supervisor/empleado, aunque el prompt lo exige.
- El drift detector no verifica de forma estricta las columnas de la constraint `UNIQUE` ni la expresión del `CHECK`.

Confirmaciones:
- `supabase migration list` muestra `0009` solo en Local y vacío en Remote, por lo tanto **no se ejecutó `supabase db push` para `0009`**.
- La migración `0009` es aditiva: agrega columnas/constraints, sin `DROP`, borrado de filas ni redefinición de tablas/enums.
- `0001_init.sql` no fue modificado en el diff contra `main`.

## 1. Delta de esquema

**Hallazgo 1 — Alto**

- **Ubicación:** inventario de migraciones `supabase/migrations/`; remoto Supabase.
- **Evidencia:** `find supabase/migrations` lista `0001` a `0007` y `0009`, sin `0008`. `supabase migration list` devuelve `Remote 0008` sin `Local`, y `Local 0009` sin `Remote`.
- **Regla violada:** Constitución §2.3 (`supabase db push` explícito y verificable), Constitución §13, y compuerta de `docs/prompts/FB-F3-01.md:114-117`.
- **Recomendación:** antes de pushear `0009`, reconciliar la migración remota `0008` en el repo local o reparar el historial de migraciones de forma explícita. No ejecutar `db push` con el historial local/remoto desalineado.

**Hallazgo 2 — Medio**

- **Ubicación:** `supabase/migrations/0009_calendario_rotaciones_cimiento.sql:43`.
- **Evidencia:** `ALTER TABLE public.profiles ADD CONSTRAINT profiles_dni_unique UNIQUE (dni);`. `dni` ya existía en `0001_init.sql:34`, por lo que producción podría tener valores no nulos duplicados previos a la constraint.
- **Regla violada:** decisión de build 8 del PRD (`docs/prd-fase-3.md:78`) y criterio de no romper filas existentes del prompt (`docs/prompts/FB-F3-01.md:58-63`).
- **Recomendación:** hacer preflight de duplicados no nulos de `profiles.dni` en remoto antes del push. `UNIQUE` permite múltiples `NULL`, pero falla si ya hay DNIs repetidos no nulos.

**Sin hallazgos adicionales:** `es_estimado` cumple `boolean NOT NULL DEFAULT false` (`0009:24-25`); `motivo_otros_texto` es nullable (`0009:30-31`); el `CHECK` permite los otros estados y solo exige motivo para `periodo_fuera_trabajo` (`0009:36-38`); el modelo real es per-día con `fecha` y `UNIQUE (user_id, fecha)` desde `0001_init.sql:102-112`; `rotation_group_id` sigue nullable (`0001_init.sql:105`).

## 2. RLS

**Hallazgo 3 — Medio**

- **Ubicación:** `supabase/migrations/0001_init.sql:390-391`.
- **Evidencia:** `rotation_groups_select_all` permite `SELECT` a cualquier usuario autenticado: `FOR SELECT USING (auth.uid() IS NOT NULL)`.
- **Regla violada:** Constitución §6 (`docs/constitucion.md:129`) y PRD Fase 3 (`docs/prd-fase-3.md:50`) definen `rotation_*` como empleado solo su calendario, supervisor su calendario + equipo, sin escritura no-admin.
- **Recomendación:** acotar la policy de `rotation_groups` o documentar una excepción explícita en PRD/Constitución si los grupos son metadata global no sensible. La migración comenta que la RLS coincide exactamente (`0009:10-13`), pero esa afirmación no es literal para `rotation_groups`.

**Sin hallazgos en `rotation_assignments`:** RLS está habilitada (`0001_init.sql:229`); admin tiene policy `FOR ALL` (`0001_init.sql:411-413`); empleado ve `user_id = auth.uid()` y supervisor ve filas cuyo `user_id` pertenece a su equipo (`0001_init.sql:401-409`); no hay policy de escritura no-admin.

## 3. Tests de RLS

**Hallazgo 4 — Alto**

- **Ubicación:** `tests/integration/rls.test.ts:522-637`.
- **Evidencia:** para `rotation_groups` y `rotation_assignments` se prueban lecturas e `INSERT`; no hay casos de `UPDATE` ni `DELETE` denegados para supervisor/empleado. Tampoco se prueba `UPDATE`/`DELETE` admin sobre `rotation_*`.
- **Regla violada:** checklist de auditoría y `docs/prompts/FB-F3-01.md:104-110`, que exige probar que supervisor y empleado no escriben y que admin escribe.
- **Recomendación:** agregar tests RLS de `UPDATE` y `DELETE` denegados para empleado y supervisor en `rotation_groups` y `rotation_assignments`; agregar al menos un `UPDATE` y `DELETE` admin para probar acceso completo.

**Sin hallazgos en lectura cruzada y CHECK:** los tests usan `asUser(...)` con `SET LOCAL ROLE authenticated` (`tests/integration/helpers.ts:237-250`), leen por id directo sin filtro de app (`rls.test.ts:561-575`), y prueban el `CHECK` positivo/negativo (`rls.test.ts:616-635`). No observé helpers que conviertan errores de RLS/query en `[]`.

Nota de verificación local: `npm run test:integration` terminó con código 0 pero saltó 153 tests porque no había PostgreSQL local. En CI, `.github/workflows/ci.yml:86-89` define `TEST_DATABASE_URL`, por lo que `global-setup.ts:18-23` debería hard-fail si Supabase local no responde.

## 4. Drift detector

**Hallazgo 5 — Alto**

- **Ubicación:** `tests/integration/migration.test.ts:191-217`.
- **Evidencia:** el test de unicidad solo verifica que exista alguna constraint única en `rotation_assignments` (`rows.length >= 1`), sin validar columnas ni orden (`user_id/profile_id`, `fecha`). El test del `CHECK` valida nombre y tipo, pero no su expresión. El test de `profiles.dni` valida la constraint única, pero no tipo/nullability de la columna.
- **Regla violada:** `docs/prompts/FB-F3-01.md:101-102` exige inventario exacto y detector estricto; checklist de auditoría pide `es_estimado`, `profiles.dni`, `CHECK`, `UNIQUE` sin aflojar exactitud.
- **Recomendación:** consultar `pg_constraint` + `pg_get_constraintdef(oid)` y `information_schema.columns` para validar exactamente `UNIQUE (user_id, fecha)`, expresión del `CHECK`, y `profiles.dni text NULL`.

## 5. `supabase/types.ts`

**Riesgo — Medio**

- **Ubicación:** `supabase/types.ts:327-429`.
- **Evidencia:** por inspección, el archivo refleja `profiles.dni` (`types.ts:331,347,363`), `rotation_assignments.es_estimado` (`types.ts:389,402,417`) y `motivo_otros_texto` (`types.ts:394,409,424`). No encontré divergencia material visible contra `0009`.
- **Regla violada:** no hay violación confirmada; riesgo operativo por edición manual señalado en la auditoría.
- **Recomendación:** después de aplicar migraciones en remoto, regenerar con `supabase gen types typescript --linked` y commitear el diff. Esto debe hacerse especialmente porque el archivo fue editado a mano.

## 6. Seguridad y transversales

**Sin hallazgos de secretos:** no hay secretos en `0009`; las menciones a service role son variables/env o tests.

**Sin hallazgos de código feature:** el diff de PR no introduce UI ni `createAdminClient()` nuevo; las ocurrencias existentes son previas.

**Confirmación de producción:** `0009` no está aplicada en remoto según `supabase migration list` (`Local 0009`, `Remote` vacío). Sí existe `Remote 0008` ausente localmente, tratado en Hallazgo 1.

## Nota de documentación

La Constitución v0.5 todavía describe `rotation_assignments` como rango `fecha_inicio`/`fecha_fin` (`docs/constitucion.md:109-110`), mientras el esquema real es per-día (`0001_init.sql:102-112`) y el PRD Fase 3 lo refina (`docs/prd-fase-3.md:72-73`). No lo considero defecto de código; queda como nota de reconciliación para el bump a v0.6.

## Veredicto final

**Requiere fix previo al push.** No ejecutar `supabase db push` hasta:

1. Reconciliar la migración remota `0008` ausente en el repo local.
2. Endurecer los tests RLS de escritura para `rotation_*`.
3. Endurecer `migration.test.ts` para validar constraints exactas.
4. Preflight de duplicados no nulos en `profiles.dni` antes de aplicar el `UNIQUE`.
