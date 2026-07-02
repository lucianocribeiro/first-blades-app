# FB-F3-AUD-02 — Re-auditoría: cierre de hallazgos FB-F3-AUD-01

Fecha: 2026-07-02  
Rama auditada: `feat/fb-f3-01-calendario-rotaciones-cimiento` (`1180981`)  
PR auditado: #3 (`https://github.com/lucianocribeiro/first-blades-app/pull/3`)  
Alcance: fixes de `FB-F3-02` sobre migración `0009`, RLS `rotation_*`, tests, drift detector y `supabase/types.ts`.

## Resumen ejecutivo

**Veredicto:** requiere fix previo al push.

Los hallazgos 1, 2, 3 y 5 de `FB-F3-AUD-01` quedaron cerrados. El riesgo de `types.ts` queda cerrado como inspección manual sin divergencia visible, con recordatorio de regenerar luego del push.

Queda un cierre **parcial** en Hallazgo 4: los tests agregados cubren `UPDATE`/`DELETE` denegado para supervisor sobre una fila de su equipo, pero no cubren el caso explícitamente pedido de `UPDATE`/`DELETE` denegado sobre una fila propia del supervisor en `rotation_assignments`.

Confirmación de producción: `supabase migration list` muestra `0001`-`0008` con `Local = Remote` y `0009` solo en `Local`; por lo tanto **`0009` no está aplicada en producción/remoto**.

## Estado por hallazgo de AUD-01

### Hallazgo 1 — Historial de migraciones

**Estado:** Cerrado.

- **Evidencia:** `git ls-tree -r --name-only HEAD -- supabase/migrations` lista `0001` a `0009` sin huecos, incluyendo `supabase/migrations/0008_notification_log.sql`.
- **Evidencia:** `supabase migration list` devuelve `0001`-`0008` con `Local = Remote` y `0009` con `Remote` vacío.
- **Evidencia:** `git diff --name-only HEAD~2..HEAD -- supabase/migrations/0001_init.sql ... 0007_profiles_unify_full_name.sql` no devuelve archivos; los fixes no editaron migraciones ya aplicadas `0001`-`0007`.
- **Regla:** Constitución §2.3 y §13; compuerta de `docs/prompts/FB-F3-01.md:114-117`.

### Hallazgo 2 — Preflight de `profiles.dni`

**Estado:** Cerrado.

- **Evidencia:** la descripción del PR #3 incluye una sección “Hallazgo 2 (Medio) — preflight de `profiles.dni`” con la consulta de duplicados no nulos: `SELECT dni, count(*) FROM profiles WHERE dni IS NOT NULL GROUP BY dni HAVING count(*) > 1;`.
- **Regla:** PRD Fase 3 decisión 8 (`docs/prd-fase-3.md:78`) y criterio de no romper filas existentes de `docs/prompts/FB-F3-01.md:58-63`.

### Hallazgo 3 — RLS de `rotation_groups`

**Estado:** Cerrado.

- **Evidencia:** `0009` corrige el comentario previo y aclara que `rotation_assignments` ya coincidía con §6, pero `rotation_groups` sí se ajusta (`supabase/migrations/0009_calendario_rotaciones_cimiento.sql:10-15`).
- **Evidencia:** `0009` elimina la policy amplia con `DROP POLICY IF EXISTS "rotation_groups_select_all" ON public.rotation_groups;` (`supabase/migrations/0009_calendario_rotaciones_cimiento.sql:50-58`).
- **Evidencia:** `migration.test.ts` valida que en `rotation_groups` solo quede la policy `rotation_groups_admin` (`tests/integration/migration.test.ts:245-252`).
- **Evidencia:** `rls.test.ts` prueba que empleado y supervisor no pueden leer `rotation_groups` por id directo (`tests/integration/rls.test.ts:528-540`), y que admin sí lee, actualiza y borra (`tests/integration/rls.test.ts:523-526`, `590-604`).
- **Regla:** Constitución §6 (`docs/constitucion.md:123-130`) y PRD Fase 3 permisos (`docs/prd-fase-3.md:50`).

### Hallazgo 4 — Tests RLS de escritura `rotation_*`

**Estado:** Parcial.

- **Evidencia de cierre parcial:** `rotation_groups` cubre `SELECT` admin-only, `INSERT` denegado para empleado/supervisor, `UPDATE`/`DELETE` denegado para empleado/supervisor y `UPDATE`/`DELETE` admin exitosos (`tests/integration/rls.test.ts:522-604`).
- **Evidencia de cierre parcial:** `rotation_assignments` cubre `INSERT` denegado para empleado/supervisor, `UPDATE`/`DELETE` denegado para empleado sobre su propia fila, `UPDATE`/`DELETE` denegado para supervisor sobre una fila de su equipo, y `UPDATE`/`DELETE` admin exitosos (`tests/integration/rls.test.ts:641-736`).
- **Evidencia de brecha:** el seed solo crea una fila de `rotation_assignments` para `IDS.employee1` (`tests/integration/rls.test.ts:74-77`). Los tests de supervisor usan esa misma fila (`tests/integration/rls.test.ts:702-719`), por lo que no prueban el caso pedido en `FB-F3-02` de supervisor intentando `UPDATE`/`DELETE` sobre su propio calendario.
- **Regla:** `docs/prompts/FB-F3-02.md` Paso 1 exige para supervisor `UPDATE`/`DELETE` denegado “tanto sobre filas propias como de su equipo”; Constitución §6 exige `rotation_*` sin escritura no-admin.
- **Recomendación:** agregar una fila de `rotation_assignments` para `IDS.supervisor` en el seed del test y dos casos explícitos: supervisor no puede `UPDATE` su propia fila y supervisor no puede `DELETE` su propia fila.

### Hallazgo 5 — Drift detector estricto

**Estado:** Cerrado.

- **Evidencia:** `migration.test.ts` valida exactamente `UNIQUE (user_id, fecha)` con `pg_get_constraintdef(oid)` y `expect(rows).toHaveLength(1)` (`tests/integration/migration.test.ts:193-203`).
- **Evidencia:** valida la expresión semántica del `CHECK`, incluyendo `estado_dia`, `periodo_fuera_trabajo`, `OR` y `motivo_ausencia IS NOT NULL` (`tests/integration/migration.test.ts:205-222`).
- **Evidencia:** valida `profiles.dni` como `text`, nullable `YES`, y `UNIQUE (dni)` (`tests/integration/migration.test.ts:224-243`).
- **Regla:** `docs/prompts/FB-F3-01.md:101-102` y `docs/prompts/FB-F3-02.md:48-55`.

### Riesgo — `supabase/types.ts`

**Estado:** Cerrado.

- **Evidencia:** `supabase/types.ts` refleja `profiles.dni` nullable (`supabase/types.ts:331,347,363`), `rotation_assignments.es_estimado` (`supabase/types.ts:389,402,417`) y `motivo_otros_texto` (`supabase/types.ts:394,409,424`).
- **Riesgo residual:** sigue siendo edición manual. La recomendación se mantiene: regenerar con `supabase gen types typescript --linked` después del `db push` y commitear el diff.

## Chequeo de regresión

- `0009` sigue siendo aditiva y no destructiva: agrega columnas/constraints y hace `DROP POLICY` de una policy, sin `DROP COLUMN`, borrado de filas ni redefinición de tablas/enums (`supabase/migrations/0009_calendario_rotaciones_cimiento.sql:28-58`).
- RLS de `rotation_assignments` permanece intacta en `0001`: `SELECT` admin/propio/equipo y `FOR ALL` admin (`supabase/migrations/0001_init.sql:401-413`).
- `es_estimado`, `motivo_otros_texto`, `CHECK` de motivo y `profiles.dni UNIQUE` siguen presentes en `0009` (`supabase/migrations/0009_calendario_rotaciones_cimiento.sql:28-48`).
- Sin secretos nuevos detectados. No se introdujo `createAdminClient()` en código de feature.
- `global-setup.ts` hace hard-fail si `TEST_DATABASE_URL` está seteado y PostgreSQL no responde (`tests/integration/global-setup.ts:18-23`); CI setea `TEST_DATABASE_URL` para integración (`.github/workflows/ci.yml:86-89`).

## Verificaciones ejecutadas

- `supabase migration list`: `0001`-`0008` Local=Remote; `0009` Local-only.
- `gh pr checks 3 --repo lucianocribeiro/first-blades-app`: integración RLS, unit/build y Vercel en `pass`.
- `npm run typecheck`: pasa.
- `npm run lint`: pasa.
- `npm run test`: 181 tests unitarios pasan.
- `npm run build`: pasa.
- `npm run test:integration`: en local saltó 169 tests por PostgreSQL no disponible; no lo cuento como pase local. CI sí reporta integración RLS `pass`.

## Veredicto final

**Requiere fix previo al push.**

Bloqueante restante:
1. Cerrar el Hallazgo 4 completamente agregando cobertura RLS de `UPDATE` y `DELETE` denegados para supervisor sobre su propia fila de `rotation_assignments`.

No ejecutar `supabase db push` de `0009` hasta cerrar ese punto y volver a confirmar CI verde.
