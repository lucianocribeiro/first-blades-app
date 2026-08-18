# FB-ADJ-AUD-03 — Auditoría de Codex

- **ID:** FB-ADJ-AUD-03
- **PR auditada:** #44
- **Rama:** `fb-adj-03-eliminar-ingreso-pendiente`
- **Fecha:** 2026-08-18
- **Veredicto:** `Aprobado — sin hallazgos`

---

# FB-ADJ-AUD-03 — Informe de auditoría

## Bloqueantes

Sin hallazgos bloqueantes.

## No bloqueantes

Sin hallazgos no bloqueantes.

## Evidencia revisada

### 1. Recreación de `employee_status`

- Severidad: OK
- Ubicación: `supabase/migrations/0021_employee_status_sin_pendiente.sql:21-35`
- Evidencia: la migración crea `employee_status_new` con exactamente `('activo', 'inactivo')`, elimina el default antes de convertir, convierte `profiles.status` con `USING status::text::employee_status_new`, repone `DEFAULT 'activo'::employee_status_new`, elimina el tipo viejo y renombra el nuevo a `employee_status`.
- Regla violada: ninguna.
- Recomendación: aplicar tal cual, bajo la premisa ya inspeccionada de producción: 0 filas con `status='pendiente'`.

### 2. Default y forma de `profiles.status`

- Severidad: OK
- Ubicación: `supabase/migrations/0021_employee_status_sin_pendiente.sql:23-31`; `tests/integration/migration.test.ts:1244-1255`
- Evidencia: el SQL conserva el `NOT NULL` porque no lo toca y repone el default. El drift detector exige `is_nullable = 'NO'`, `udt_name = 'employee_status'` y `column_default` equivalente a `'activo'::employee_status`.
- Regla violada: ninguna.
- Recomendación: ninguna.

### 3. Dependencias del tipo

- Severidad: OK
- Ubicación: `supabase/migrations/0021_employee_status_sin_pendiente.sql:33-35`; `tests/integration/migration.test.ts:1257-1269`
- Evidencia: el `DROP TYPE employee_status` ocurre después de migrar la columna y su default. Si hubiera una dependencia de negocio no contemplada, el `DROP TYPE` fallaría en vez de dejar estado parcial silencioso. El test nuevo afirma que el tipo final solo tiene las dependencias esperadas: columna, default y array implícito.
- Regla violada: ninguna.
- Recomendación: ninguna.

### 4. `pendiente` en dominio correcto

- Severidad: OK
- Ubicación: `supabase/types.ts:702`, `supabase/types.ts:710`, `supabase/types.ts:861`, `supabase/types.ts:870`; `lib/purgatorio.ts:7-20`; `lib/copy/index.ts:66-67`
- Evidencia: `employee_status` quedó como `"activo" | "inactivo"` y constants `["activo", "inactivo"]`. `approval_status` conserva `"pendiente" | "aprobado" | "rechazado"`. `copy.status.pendiente` sigue vivo y lo usa `lib/purgatorio.ts`, correcto para purgatorio/approval_status.
- Regla violada: ninguna.
- Recomendación: ninguna.

### 5. Eliminación de "Ingreso"

- Severidad: OK
- Ubicación: `app/(app)/formularios/page.tsx` eliminado; `components/layout/PlaceholderPage.tsx` eliminado; `lib/roles.ts:6-16`; `components/layout/Sidebar.tsx:29-40`; `components/layout/Topbar.tsx:22-34`; `lib/copy/index.ts`
- Evidencia: no queda ruta `/formularios`, no queda `RouteKey`/`roleAccess`, no queda entrada en Sidebar/Topbar ni copy de página/nav. `rg "PlaceholderPage" app components lib tests` no encontró imports vivos. El único test eliminado es `tests/unit/nav-ingreso-rename.test.ts`.
- Regla violada: ninguna.
- Recomendación: ninguna.

### 6. Gate de acceso y alta

- Severidad: OK
- Ubicación: `lib/auth.ts:26-41`; `tests/unit/auth-gate.test.ts:83-121`; `app/(app)/gestion-usuarios/actions.ts:47-57`
- Evidencia: el gate sigue rechazando todo `status !== 'activo'`. El caso que antes cubría rechazo con `pendiente` fue reemplazado por `inactivo`, incluyendo el caso "JWT válido pero status inactivo". El alta sigue seteando `status: 'activo'` explícitamente.
- Regla violada: ninguna.
- Recomendación: ninguna.

### 7. Documentación y alcance

- Severidad: OK
- Ubicación: `docs/constitucion.md`; `CLAUDE.md`; `docs/prompts/FB-ADJ-03.md`; `docs/prompts/FB-ADJ-03-DOC.md`; `docs/prompts/FB-ADJ-03-DOC-02.md`; `docs/prompts/FB-ADJ-03-INSPECT-REPORT.md`
- Evidencia: Constitución solo borra la fila "Ingreso" y reduce `employee_status`; no hay bump de versión. `CLAUDE.md` solo borra la fila del menú. Los cuatro docs del ajuste están agregados. No se tocaron `FB-ADJ-01*`, `FB-ADJ-02*` ni audits anteriores. `docs/pdr-fase-4.md` y `docs/pdr-fase-5.md` siguen untracked.
- Regla violada: ninguna.
- Recomendación: ninguna.

### 8. Higiene y CI

- Severidad: OK
- Ubicación: PR #44
- Evidencia: `gh pr view 44` reporta PR abierto, base `main`, rama `fb-adj-03-eliminar-ingreso-pendiente`, `mergeStateStatus: CLEAN`. CI verde el 2026-08-18: `Typecheck · Lint · Tests · Build`, `Tests de integración RLS (Supabase local)` y `E2E Playwright (stack efímero)` en success. Vercel también success.
- Regla violada: ninguna.
- Recomendación: ninguna.

## Verificación local

- `npm run test -- tests/unit/auth-gate.test.ts tests/unit/equipo.test.ts tests/unit/role-limits.test.ts`: 95/95 pasan.
- `npm run typecheck`: pasa.
- `git diff --check origin/main...HEAD`: limpio.
- `npm run test:integration -- tests/integration/migration.test.ts`: localmente se salteó completo porque no hay PostgreSQL disponible; por lectura, los tres tests nuevos ejercitan lo declarado y CI sí corrió integración con Supabase local en verde.

## Veredicto

Aprobado. No encontré hallazgos bloqueantes ni no bloqueantes.

¿Esta migración está en condiciones de aplicarse a producción? Sí, con la condición operativa ya documentada y confirmada por la inspección: producción está en 0020 y no tiene filas `profiles.status = 'pendiente'`.

---

## Cierre

Este informe habilita el merge de la PR #44 (`fb-adj-03-eliminar-ingreso-pendiente` → `main`) y, posteriormente, el `db push` de la migración `0021` vía su propio runbook gateado. El merge y el push son pasos separados: este veredicto autoriza el primero; el segundo queda condicionado a la verificación de catálogo post-push descrita en `docs/prompts/FB-ADJ-03.md`.
