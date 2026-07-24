# FB-F4-AUD-02 — Auditoria: migracion 0015 resolver_ausencia_request

> Auditoria independiente de PR #21 `feat/fb-f4-03-resolver-rango -> main` contra Constitucion v0.6 y prompt `FB-F4-03 (v2)`.
> Fecha: 2026-07-20.

## Veredicto

**Con hallazgos.** El delta funcional principal esta correcto: `motivo_otros_texto` se agrega como espejo `VARCHAR(80)` y se propaga desde `v_request` tanto en el `INSERT` como en el `ON CONFLICT DO UPDATE`. Las guardas criticas de la funcion se preservan. Quedan dos hallazgos bajos de higiene/coverage.

## Hallazgos

### Bajo — La migracion no re-asevera `REVOKE`/`GRANT` tras el `CREATE OR REPLACE`

- **Ubicacion:** `supabase/migrations/0015_resolver_ausencia_rango.sql:22-27` y final de archivo.
- **Evidencia:** la migracion documenta que `CREATE OR REPLACE` preserva el ACL porque no cambia la firma, pero no repite las sentencias explicitas de `0013` (`REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon`, `GRANT EXECUTE ... TO authenticated`). El archivo termina en el cierre de la funcion, sin re-aseverar permisos.
- **Regla violada:** punto 5 del prompt de auditoria / Constitucion §6.1: si el patron del repo declara grants/revokes junto a la funcion, el replace debe re-aseverarlos para no depender de estado implicito.
- **Impacto:** no parece producir una regresion efectiva en el camino normal, porque `CREATE OR REPLACE` preserva ACL al mantener la firma y el drift detector verifica que `authenticated=true`, `anon=false`, `public=false`. Pero la migracion queda menos autosuficiente para un objeto sensible `SECURITY DEFINER`.
- **Recomendacion:** agregar al final de `0015` las mismas tres sentencias de `0013` para dejar el estado deseado explicito en la propia migracion.

### Bajo — La prueba de atomicidad de rango no ejecuta el paso afirmado bajo `asUser`

- **Ubicacion:** `tests/integration/resolver-ausencia-request.test.ts:53-60`, `tests/integration/resolver-ausencia-request.test.ts:465-480`.
- **Evidencia:** el caso "atomicidad de rango" usa `asAdminSuperuser(...)`, que abre una conexion como superusuario y solo setea `request.jwt.claims`; no usa `asUser(IDS.admin)` ni `SET LOCAL ROLE authenticated` para la invocacion de `resolver_ausencia_request`. El helper es comprensible para crear el CHECK temporal, pero la llamada que se afirma corre como `postgres`, no como rol acotado.
- **Regla violada:** punto 13 del prompt de auditoria: las pruebas de integracion deben afirmar los pasos bajo `asUser`, no `service_role`/rol privilegiado, incluida atomicidad.
- **Impacto:** la atomicidad de la transaccion queda bien ejercitada, pero ese escenario no cubre exactamente el camino de ejecucion del rol `authenticated`. Los happy paths y guardas si corren bajo `asUser`, asi que el riesgo es de cobertura, no de comportamiento observado.
- **Recomendacion:** mantener el setup DDL privilegiado si hace falta, pero antes de invocar la RPC cambiar a rol `authenticated` con claims de admin, o estructurar el test para que el fallo exista como fixture y la llamada se haga mediante `asUser(IDS.admin)`.

## Verificaciones

- **Guardas §6.1:** `SECURITY DEFINER` y `SET search_path = public` estan redeclarados en `0015` (`supabase/migrations/0015_resolver_ausencia_rango.sql:45-54`). La guarda usa `auth.uid() IS NULL OR NOT public.is_admin()` (`:62-70`), y la request se toma con `SELECT ... FOR UPDATE` (`:79-82`).
- **Delta funcional:** `motivo_otros_texto` viene de `v_request.motivo_otros_texto`, no de un parametro externo, y se propaga en ambas ramas del upsert (`supabase/migrations/0015_resolver_ausencia_rango.sql:131-139`).
- **Sin regresion del resto:** el loop inclusivo `WHILE v_dia <= v_request.fecha_fin`, `estado_dia='periodo_fuera_trabajo'`, `es_estimado=false`, motivo dinamico y transicion de request se mantienen respecto de `0013`.
- **Columna:** `ausencia_requests.motivo_otros_texto` se agrega nullable como `VARCHAR(80)` (`supabase/migrations/0015_resolver_ausencia_rango.sql:36-37`), igual que `rotation_assignments.motivo_otros_texto` en `0009`. No agrega CHECK, consistente con el espejo.
- **Drift detector:** `tests/integration/migration.test.ts` valida la columna nueva, que los CHECKs de `ausencia_requests` siguen siendo exactamente los de `0012`, y que la funcion conserva firma, `prosecdef`, `proconfig`, owner no-app-role y grants efectivos.
- **Tests:** los casos nuevos cubren rango de 5 dias, sobrescritura, `otros` con texto, multi-motivo y atomicidad de rango. Los casos preexistentes siguen cubriendo rechazo, guardas de seguridad y dia unico sin regresion.
- **CI:** PR #21 esta `MERGEABLE` / `CLEAN`. Checks verdes el 2026-07-20: `Tests de integracion RLS (Supabase local)` y `Typecheck · Lint · Tests · Build`. El workflow define `TEST_DATABASE_URL`; con esa variable el global setup falla si Postgres no responde, asi que el job verde no es un skip silencioso.
- **Ejecucion local:** `npm run test:integration -- tests/integration/resolver-ausencia-request.test.ts tests/integration/migration.test.ts` quedo skipped localmente porque no hay Supabase/Postgres local disponible. Se toma CI como evidencia autoritativa para integracion.
- **Seguridad:** no se encontraron secretos ni cambios a RLS/policies. El diff no altera owner ni firma de la funcion; el owner queda para verificacion de catalogo post-push en `FB-F4-RUN-02`.
