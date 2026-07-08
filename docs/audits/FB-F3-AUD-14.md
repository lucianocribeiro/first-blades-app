# FB-F3-AUD-14 — Informe de auditoría (Codex)

## Hallazgos

### Medio — Drift detector no prueba el delta exacto
- **Ubicación:** `tests/integration/migration.test.ts:365`
- **Evidencia:** los tres objetos se verifican individualmente mediante expresiones regulares. No existe un inventario de constraints/índices comparado con `toEqual`, por lo que un cuarto objeto accidental no sería detectado.
- **Regla violada:** requisito de drift detector "exactamente los 3 objetos; ni de más ni de menos".
- **Recomendación:** consultar los CHECK e índices propios de `ausencia_requests` y comparar sus nombres/definiciones esperadas con `toEqual`.

### Medio — Cobertura RLS negativa incompleta
- **Ubicación:** `tests/integration/rls.test.ts:453`, `tests/integration/ausencia-requests-purgatorio.test.ts:14`
- **Evidencia:**
  - No hay prueba de que un empleado no pueda insertar usando el `user_id` de otro.
  - Solo se prueba el `UPDATE` prohibido para supervisor, no para empleado.
  - Los 11 tests nuevos usan `service_role`, no JWT acotado mediante `asUser`.
- **Regla violada:** cobertura solicitada de RLS bajo JWT, incluyendo inserción por otro usuario y modificación de estado por cualquier no-admin.
- **Recomendación:** agregar casos `asUser` directos para ambos escenarios. Los tests de constraints pueden conservar `service_role`.

## Verificaciones limpias
- `0012` agrega exclusivamente dos CHECK y un índice: `supabase/migrations/0012_ausencia_requests_purgatorio_invariantes.sql:24`.
- Enum real: `pendiente`, `aprobado`, `rechazado`.
- Columnas reales correctamente utilizadas: `motivo_rechazo`, `reviewed_by`, `reviewed_at`.
- El índice usa `(user_id, motivo_ausencia, fecha_inicio, fecha_fin)`; `rotation_assignments` también identifica al empleado mediante `user_id`.
- La RLS real fuerza inserciones no-admin propias y pendientes, y reserva los updates al admin: `supabase/migrations/0001_init.sql:359`.
- Producción tiene 0 filas en `ausencia_requests`; no existe riesgo actual de datos que bloqueen el push.
- `migration list`: remoto hasta 0011; 0012 únicamente local.
- PR #12 corresponde al commit auditado y todos sus checks están verdes.

## Veredicto
**Requiere fix antes del merge:**
1. Completar cobertura RLS negativa.
2. Convertir el drift detector en un inventario exacto de los tres objetos.

## Resolución
Cerrado con **FB-F3-15** (fix de solo-tests): drift detector convertido a inventario exacto (`toEqual`) y cobertura RLS negativa agregada bajo `asUser` (insert por otro `user_id` e `UPDATE` de estado por empleado). CI verde en PR #12. Por convención, fix de solo-tests no requiere re-auditoría.
