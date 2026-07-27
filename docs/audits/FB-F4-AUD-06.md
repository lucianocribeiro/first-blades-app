# FB-F4-AUD-06 - Re-auditoria acotada: audit por dia + tests bajo asUser

> Re-auditoria acotada de PR #24 `feat/fb-f4-07-resolver-pasaje -> main`, limitada a los dos hallazgos de `FB-F4-AUD-05` corregidos por `FB-F4-08`.
> Fecha: 2026-07-27.

## Veredicto

**Limpio.** Los dos hallazgos quedaron resueltos sin regresiones observadas en su vecindad. `resolver_pasaje_request` ahora audita una fila por cada dia de calendario sobrescrito, conserva la fila de transicion de la request, y los escenarios de atomicidad corregidos invocan la RPC bajo `asUser(IDS.admin)`.

## Hallazgos

No se encontraron hallazgos en el alcance acotado.

## Verificaciones

- **Audit por dia - contrato:** `supabase/migrations/0016_resolver_pasaje.sql` toma `old_data` de `rotation_assignments` para cada `v_dia`, hace el upsert con `RETURNING id INTO v_cal_id`, y registra `audit_log` con `table_name='rotation_assignments'`, `record_id=v_cal_id`, `actor_id=auth.uid()`, `old_data` puntual o `NULL`, y `new_data` con `estado_dia='en_viaje'`, `motivo_ausencia=NULL`, `motivo_otros_texto=NULL`, `es_estimado=false`.
- **Fila de transicion conservada:** la aprobacion sigue insertando una fila `pasaje_approved` sobre `pasaje_requests` antes del loop. Esa fila queda simplificada a `new_data={ estado: 'aprobado' }`; ya no embute `calendario_pisado`, porque el detalle vive en las filas por-dia.
- **Conteo 1 + N:** los tests de aprobacion y sobrescritura esperan una fila de transicion mas N filas `pasaje_calendario_sobrescrito` correlacionadas por el id real de `rotation_assignments`. Para 3 dias, el total esperado es 1 + 3.
- **Rechazo sin audit por dia:** la rama `rechazar` no toca el loop ni `rotation_assignments`; solo inserta la transicion `pasaje_rejected`. El test de rechazo afirma que no aparecen filas `pasaje_calendario_sobrescrito`.
- **Atomicidad:** las inserciones por-dia estan dentro del mismo cuerpo PL/pgSQL de la funcion, sin commits ni savepoints intermedios. Un error en update/upsert/audit aborta la invocacion completa y revierte estado de request, calendario y audit.
- **Atomicidad bajo asUser:** los dos casos corregidos (`falla el upsert de rotation_assignments` y `falla el INSERT a audit_log`) hacen el setup DDL privilegiado en una conexion separada, limpian el constraint temporal en `finally`, e invocan `resolver_pasaje_request` dentro de `asUser(IDS.admin)`. El tercer caso de atomicidad tambien corre bajo `asUser(IDS.admin)`.
- **Rollback total en tests:** los tres casos de atomicidad afirman que la request sigue `pendiente`, que no persisten filas de calendario para los dias afectados y que no queda audit de transicion cuando corresponde. El caso multi-dia verifica que tambien desaparece la fila ya insertada antes del dia que falla.
- **Vecindad sin regresion:** el diff de `FB-F4-08` queda limitado a `docs/prompts/FB-F4-08.md`, `supabase/migrations/0016_resolver_pasaje.sql` y `tests/integration/resolver-pasaje-request.test.ts`. No se tocaron guardas de §6.1, destino `empleado_id`, `en_viaje` sin motivo, limpieza de motivos al sobrescribir, `CHECK` de `dias_viaje`, RLS, grants fuera de la funcion, ni `resolver_ausencia_request`.
- **Divergencia documentada:** el 0016 y el prompt documentan que `resolver_ausencia_request` sigue agrupando su audit en `calendario_pisado`, mientras pasaje queda por-dia. No hay cambios a ausencia en este fix.
- **Nomenclatura de action:** `pasaje_calendario_sobrescrito` es especifica del calendario de pasaje y no colisiona de forma confusa con las transiciones `pasaje_approved` / `pasaje_rejected` ni con acciones de ausencia.
- **Tests locales:** `npm run test:integration -- tests/integration/resolver-pasaje-request.test.ts tests/integration/migration.test.ts` quedo skipped localmente por falta de PostgreSQL/Supabase local disponible.
- **CI:** en PR #24, el check `Tests de integracion RLS (Supabase local)` paso de verdad junto con `Typecheck - Lint - Tests - Build`, Vercel y Vercel Preview Comments.
- **Estado PR:** PR #24 esta abierto, no draft y sin conflictos de merge observados durante la re-auditoria.
