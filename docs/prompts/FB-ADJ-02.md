# FB-ADJ-02 — Fix: RPC atómica crear+aprobar (admin) + CLAUDE.md + banner

> **Ajuste inter-fase · Fix.** Para Claude Code, vía Luciano.
> Resuelve los tres hallazgos de `FB-ADJ-AUD-01` (Alta + Media + Baja). El **Alta lleva migración** (RPC nueva) → **re-auditoría** (`FB-ADJ-AUD-02`) + **runbook** (`FB-ADJ-RUN-01`). Se commitea **sobre la misma branch de PR #37**.

---

## 1. Objetivo

1. **[Alta] Atomicidad sin huérfanas:** reemplazar la secuencia no-atómica `insert(pendiente) → resolver(aprobar) → cleanup` por una **RPC transaccional** que **cree y apruebe en una sola transacción**, para que ningún fallo (excepción, timeout, crash entre requests, cleanup fallido) pueda dejar una solicitud de admin colgada.
2. **[Media] CLAUDE.md consistente:** la tabla de menú y la nota todavía dicen que el admin entra en "modo consulta (no envía)" en Ausencia/Pasaje, y siguen nombrando "Formularios". Alinear con la Constitución v0.7.1.
3. **[Baja] Banner del form para admin:** el form muestra "Tu solicitud será revisada por Administración" incluso para admin (que se auto-aprueba). Condicionar el copy.

---

## 2. Alcance

### Fix 1 — RPC atómica crear+aprobar (migración 0019)

**Inspección previa (reportar):** confirmar que una función `SECURITY DEFINER` puede **insertar la solicitud (pendiente, para el propio admin) y luego invocar la RPC de resolución existente** (`resolver_ausencia_request`/`resolver_pasaje_request`) **dentro de la misma transacción**, reutilizando su lógica de escritura de calendario + audit sin duplicarla. `auth.uid()` persiste dentro de la función anidada (la guarda de admin de la resolver sigue aplicando). Traer las firmas de las resolvers y el patrón §6.1.

**Migración `supabase/migrations/0019_admin_crear_aprobar.sql`** — dos funciones `SECURITY DEFINER`:
- `crear_aprobar_ausencia_admin(p_motivo, p_fecha_inicio, p_fecha_fin, p_motivo_otros_texto)` (ajustar tipos al esquema real).
- `crear_aprobar_pasaje_admin(p_motivo_viaje, p_origen, p_destino, p_dias_viaje)`.

Cada una, en **una transacción**:
1. Guarda §6.1: `auth.uid() IS NULL OR NOT public.is_admin()` → raise (NULL=no-admin). `search_path=public`.
2. Insertar la solicitud **para sí** (`user_id`/`empleado_id` = `auth.uid()`, `solicitante_id`=`auth.uid()` en pasaje), estado `pendiente`.
3. **Invocar la resolver existente** con `p_accion='aprobar'` sobre la fila recién creada → escribe calendario + `reviewed_by`=admin + `audit_log`, todo dentro de la misma transacción.
4. Grants: `EXECUTE` a `authenticated`; `REVOKE` de `anon`/`PUBLIC`. Owner = `postgres`.

> Si la exclusion constraint de no-solapamiento (ausencia) o el CHECK de `dias_viaje` (pasaje) rechaza el insert, la transacción entera revierte → la action lo traduce a copy amigable. Correcto: no queda nada a medias.

**Rewire de las actions** (`solicitud-ausencia/actions.ts`, `solicitud-pasaje/actions.ts`): en el branch admin, llamar a la **RPC única** (con `createServerClient()`) en vez del `insert + resolve + cleanup`. **Eliminar** el código de compensación/borrado (ya no hace falta). No-admin sin cambios. Mantener la no-retroactiva server-side **antes** de invocar la RPC. Contrato return-based; errores visibles.

**Tests:** actualizar/eliminar el test que **aceptaba** la fila huérfana (ya no es un caso válido — la atomicidad lo elimina). Nuevos: admin crea+aprueba en una transacción (calendario escrito, `aprobado`, `reviewed_by`=admin, audit por-día); un fallo forzado (ej. violar el CHECK/constraint) **no deja nada** (ni solicitud, ni calendario, ni audit) — rollback total; no-admin sin cambios; no-retroactiva aplica.

### Fix 2 — CLAUDE.md (Media)
- Actualizar la **tabla de menú**: Ausencia y Pasaje ya no son "✓ (consulta)" para admin → el admin **envía para sí** con auto-aprobación (self-only); admin **por otro** → `pendiente`.
- Corregir la **nota** que dice "modo consulta (no envía)".
- Renombrar **"Formularios" → "Ingreso"** donde aparezca en `CLAUDE.md`.

### Fix 3 — banner del form (Baja)
- En `SolicitudAusenciaForm`/`SolicitudPasajeForm`, **condicionar** el banner de purgatorio: para `isAdmin=true`, no mostrar "será revisada por Administración"; mostrar copy de auto-aprobación (o suprimir el banner, ya que el diálogo de confirmación ya comunica la auto-aprobación). Copy es-AR en `/lib/copy`.

---

## 3. Tests / CI

- Integración `asUser` (claims admin) contra Postgres real: crear+aprobar atómico (ambos tipos); rollback total ante fallo (nada huérfano); no-admin sin cambios; no-retroactiva.
- Unit/RTL: banner condicionado por rol; diálogo de confirmación intacto.
- e2e: admin envía y queda auto-aprobado (sin romper el gate).
- 3 jobs verdes.

---

## 4. Pasos operativos

1. Sobre la branch de PR #37, inspección → migración 0019 + rewire actions + CLAUDE.md + banner → tests.
2. `commit → push → GitHub Actions`. CI de verdad (3 jobs).
3. **Versionar** `docs/prompts/FB-ADJ-02.md`.
4. Reportar: diseño de las 2 RPCs (reuso de las resolvers), rewire de actions (cleanup eliminado), diffs de CLAUDE.md y banner, estado de CI, `git status`.

**No mergear ni pushear a la base.** Re-auditoría (`FB-ADJ-AUD-02`) → merge gateado por Luciano → `db push` (`FB-ADJ-RUN-01`, con verificación de catálogo de las 2 funciones nuevas).

---

## 5. Definition of Done

- [ ] Inspección reportada; confirmado que la RPC anida la resolver en una sola transacción sin duplicar lógica.
- [ ] Migración 0019: 2 RPCs `SECURITY DEFINER` crear+aprobar (para sí), guardas §6.1, grants re-aseverados, owner postgres.
- [ ] Actions rewired al llamado único; **código de compensación/borrado eliminado**; no-admin sin cambios; no-retroactiva antes de la RPC.
- [ ] Test de "huérfana aceptada" eliminado/reemplazado; nuevo test de **rollback total ante fallo** (nada persiste).
- [ ] CLAUDE.md: tabla + nota + renombre "Ingreso" consistentes con la Constitución v0.7.1.
- [ ] Banner del form condicionado para admin (no "será revisada").
- [ ] Tests (integración `asUser` + RTL + e2e) verdes; 3 jobs verdes.
- [ ] `docs/prompts/FB-ADJ-02.md` versionado; `git status` limpio.
- [ ] Migración **NO** aplicada a prod (queda para `FB-ADJ-RUN-01`).
