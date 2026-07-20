# FB-F4-AUD-01 — Auditoria: migracion 0014 no-solapamiento

> Auditoria independiente de PR #20 `feat/fb-f4-01-ausencia-no-solapamiento -> main` contra Constitucion v0.6 y prompt `FB-F4-01`.
> Fecha: 2026-07-20.

## Veredicto

**Con hallazgos.** La migracion y la traduccion de error implementan correctamente la regla de negocio. Queda un hallazgo de cobertura de tests: dos escenarios pedidos bajo JWT acotado se validan con `service_role`.

## Hallazgos

### Medio — Dos escenarios de integracion validan la insercion con `service_role`, no con JWT acotado

- **Ubicacion:** `tests/integration/ausencia-no-solapamiento.test.ts:87` y `tests/integration/ausencia-no-solapamiento.test.ts:95`.
- **Evidencia:** los casos "dos empleados distintos pueden tener pendientes con rangos solapados" y "una ausencia APROBADA no bloquea una nueva pendiente" ejecutan la insercion esperada dentro de `asServiceRole(...)` (`tests/integration/ausencia-no-solapamiento.test.ts:88-104`). El mismo archivo reconoce que esos casos corren como `service_role` (`tests/integration/ausencia-no-solapamiento.test.ts:13-20`).
- **Regla violada:** punto 14 del prompt de auditoria: "Bajo JWT de rol (`asUser`), no `service_role`: los tests de insercion prueban la constraint bajo el rol acotado leyendo/insertando directo", incluyendo los escenarios entre empleados distintos y aprobada-no-bloquea.
- **Impacto:** no invalida la constraint en si, que esta correctamente definida y cubierta para los casos de solapamiento/no-solapamiento del mismo empleado bajo `asUser`. Pero deja sin probar que esos dos caminos permitidos funcionen por el mismo rol acotado que usa la app, especialmente que una pendiente propia solapada con una aprobada previa no sea bloqueada bajo RLS real.
- **Recomendacion:** ajustar esos dos tests para que solo el setup indispensable use un cliente privilegiado si hace falta, pero que la insercion que se esta afirmando ocurra con `asUser`. Por ejemplo: sembrar la aprobada como fixture y luego insertar la pendiente como `IDS.employee3` via `asUser`; para empleados distintos, persistir/sembrar la fila inicial y validar la segunda insercion con el JWT del otro empleado.

## Verificaciones

- **Constraint:** `supabase/migrations/0014_ausencia_no_solapamiento.sql:26-46` crea `btree_gist`, elimina `public.ausencia_requests_pendiente_unica`, y agrega `ausencia_requests_no_solapamiento_pendiente` con `user_id WITH =`, `daterange(fecha_inicio, fecha_fin, '[]') WITH &&`, y `WHERE (estado = 'pendiente')`. No incluye `motivo_ausencia`.
- **Scope:** el predicado parcial limita el bloqueo a pendiente-contra-pendiente. No bloquea por filas `aprobado`/`rechazado`.
- **Inclusividad:** el rango usa `'[]'`, por lo que compartir un dia en el borde cuenta como solapamiento.
- **Delta-only:** el diff de PR #20 toca la migracion 0014, drift detector, tests, el prompt versionado y la traduccion del error. No toca RLS/policies, columnas/enums de `ausencia_requests`, ni `resolver_ausencia_request`.
- **Traduccion de error:** `app/(app)/solicitud-ausencia/logic.ts:4-40` cambia la traduccion especifica a SQLSTATE `23P01` (`exclusion_violation`) y no atrapa otros codigos. El copy sigue siendo de usuario via `copy.solicitudAusencia.errors.pendienteDuplicada`; no expone constraint ni codigo SQL.
- **Drift detector:** `tests/integration/migration.test.ts` valida `btree_gist`, la exclusion constraint por catalogo, el indice implicito de respaldo y la ausencia del indice viejo.
- **CI:** PR #20 esta `MERGEABLE` / `CLEAN`. Checks verdes el 2026-07-20: `Tests de integracion RLS (Supabase local)` y `Typecheck · Lint · Tests · Build`. El workflow define `TEST_DATABASE_URL`; con esa variable, `tests/integration/global-setup.ts:15-23` falla si Postgres no responde, por lo que ese job no puede pasar por skip silencioso de DB ausente.
- **Ejecucion local:** `npm run test -- tests/unit/solicitud-ausencia.test.ts` paso (16 tests). `npm run test:integration -- tests/integration/ausencia-no-solapamiento.test.ts tests/integration/migration.test.ts` quedo skipped localmente porque no habia Postgres/Supabase local disponible; se toma CI como evidencia autoritativa para integracion.
- **Seguridad:** no se encontraron secretos ni cambios a policies/RLS ni funciones `SECURITY DEFINER` en el delta auditado.
