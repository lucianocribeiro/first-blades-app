# FB-ADJ-01 — Renombre "Formularios" → "Ingreso" + admin auto-envío de Ausencia/Pasaje

> **Ajuste inter-fase (entre Fase 4 y Fase 5) · Build.** Para Claude Code, vía Luciano.
> Autocontenido, es-AR. Alineado con la Constitución (**v0.7**) — que **esta pieza actualiza** (ver §5).
> Prefijo `FB-ADJ` = ajuste inter-fase (no pertenece a una fase). **Probablemente sin migración** (reutiliza las RPCs existentes) — la inspección lo confirma.

---

## 1. Objetivo

Dos cambios cohesivos:
- **A) Renombrar** el ítem de menú **"Formularios" → "Ingreso"** (es el módulo de ingreso/precarga de nuevos empleados; sigue "próximamente"). Solo cambia la **etiqueta**, no el contenido.
- **B) Habilitar que el Administrador envíe** Solicitud de Ausencia y Solicitud de Pasaje **para sí**, y que esas solicitudes se **auto-aprueben** (no pasan por la bandeja Aprobaciones), con un diálogo de confirmación previo.

---

## 2. Decisiones cerradas (con Luciano)

- El admin **ve** y **puede enviar** Solicitud de Ausencia y Solicitud de Pasaje **para sí mismo** (`admin-para-sí solamente` — **supuesto reversible**; "admin por otros" queda fuera de alcance, decisión aparte).
- La solicitud enviada por un admin **no requiere aprobación**: se aprueba automáticamente y escribe el calendario en el momento (`periodo_fuera_trabajo` para ausencia / `en_viaje` para pasaje). Aplica a **ambos** (ausencia y pasaje).
- **Diálogo de confirmación** antes de enviar (solo cuando el que envía es admin): copy propuesto — *"Como administrador, esta solicitud se aprueba automáticamente y no pasa por revisión. ¿Confirmás el envío?"* (ajustable en `/lib/copy`).
- El registro queda **completo y con el nombre del admin**: `reviewed_by`/`reviewed_at` seteados, `audit_log` legible como auto-aprobación (el solicitante es también el aprobador). Sin huecos en el historial.
- **No-retroactiva sigue aplicando** aun para el admin (fechas ≥ hoy, huso Argentina).

---

## 3. Inspección previa (OBLIGATORIA — delta-only) — reportar

Vía repo + MCP (solo-lectura):
1. **Nav / menú por rol:** dónde se define la etiqueta "Formularios" y la visibilidad por rol de Solicitud de Ausencia / Pasaje. ¿El admin las ve hoy? (para habilitarlas si no).
2. **RLS de inserción** en `ausencia_requests` / `pasaje_requests`: ¿un **admin** puede insertar una solicitud propia? ¿En qué estado la deja (la policy `*_insert_non_admin` fuerza `pendiente` a no-admin; confirmar qué pasa con admin)?
3. **RPCs de resolución** (`resolver_ausencia_request` / `resolver_pasaje_request`): confirmar que un admin puede invocarlas para aprobar (guarda `is_admin()`), y que aprobar escribe el calendario + `reviewed_by=auth.uid()` + `audit_log`.
4. **Forms actuales** (`SolicitudAusenciaForm` / `SolicitudPasajeForm`): cómo arman el envío, si tienen selector "para quién" (supervisor) que haya que ocultar para admin (admin-para-sí = implícito self, sin selector).
5. **Contrato return-based** ya vigente en esas actions (de FB-F4-16): reutilizarlo.

> Reportar el hallazgo clave: **¿alcanza con reutilizar (crear pendiente + invocar resolver-aprobar en la misma action), o hace falta una migración?** Preferencia: **sin migración** (ver §4). Si la atomicidad no se puede garantizar de forma aceptable sin RPC, **flaguearlo** y lo decidimos (podría justificar una RPC chica).

---

## 4. Alcance

### A) Renombre
- Cambiar la etiqueta "Formularios" → **"Ingreso"** en la config de navegación (es-AR). Sin tocar la ruta ni el contenido "próximamente".

### B) Admin auto-envío
- **Visibilidad:** mostrar Solicitud de Ausencia y Solicitud de Pasaje en el menú del **Administrador**.
- **Formulario:** el admin envía **para sí** (`user_id`/`empleado_id` = el propio admin). Si el form de pasaje tiene selector de empleado (para supervisor), **ocultarlo/forzar self** cuando el rol es admin.
- **Diálogo de confirmación** (solo admin) antes de enviar, con el copy de §2.
- **Flujo de envío (auto-aprobación) — preferencia sin migración:**
  - La action, cuando el solicitante es admin: valida (no-retroactiva, no vacío, etc.) → crea la solicitud (propia) → **invoca la RPC de resolución con `p_accion='aprobar'`** (con `createServerClient()`, el JWT del admin pasa la guarda) → el calendario se escribe y la solicitud queda `aprobado` con `reviewed_by`=admin.
  - **Sin solicitudes huérfanas:** si la resolución falla, la action **limpia** la solicitud recién creada (o la deja en un estado consistente) y devuelve `{ok:false, error}`. Ningún `pendiente` de admin colgado. (Si esta secuencia no garantiza atomicidad aceptable, flaguearlo → evaluar RPC chica que cree+apruebe en una transacción.)
  - Para no-admin: comportamiento **sin cambios** (crea `pendiente`, va a Aprobaciones, sin diálogo).
- **Contrato return-based** en la action (reusar). **Errores visibles, no tragados.**
- **Mail:** sigue el camino de aprobación existente (best-effort post-commit); para auto-envío el destinatario es el propio admin — no requiere caso especial.

### C) Constitución (fuente de verdad — mantenerla honesta)
- Editar `docs/constitucion.md` (**edición quirúrgica**):
  - **§4:** el Administrador ahora **envía para sí** Solicitud de Ausencia y Pasaje (además de aprobar), con **auto-aprobación** (sin pasar por Aprobaciones).
  - **Principio "nada se autoactiva":** agregar la **excepción explícita** — las solicitudes **de un admin para sí** se auto-aprueban (registradas en `audit_log`, con `reviewed_by`=admin). Es la única excepción; todo lo demás sigue pasando por el purgatorio.
  - Renombre de "Formularios" → "Ingreso" si la Constitución nombra ese ítem.
  - Bump menor de versión con nota (ej. **v0.7.1**) + entrada en "Decisiones cerradas".

---

## 5. Tests

- **Renombre:** el menú muestra "Ingreso" (no "Formularios"); ruta/contenido intactos.
- **Admin envía ausencia/pasaje para sí (integración `asUser` con claims de admin):** la solicitud queda `aprobado`, el calendario escrito (`periodo_fuera_trabajo`/`en_viaje`), `reviewed_by`=admin, `audit_log` completo. **No** queda `pendiente` en Aprobaciones.
- **Fallo en la resolución:** la solicitud no queda huérfana (limpiada o consistente); la action devuelve `{ok:false, error}` visible.
- **No-retroactiva** aplica al admin (fecha pasada → rechazada).
- **No-admin sin cambios:** empleado/supervisor crean `pendiente`, van a Aprobaciones, sin diálogo ni auto-aprobación.
- **Admin-para-sí:** el admin no puede (por esta vía) enviar por otro (self forzado).
- **e2e (opcional pero recomendado):** admin envía una ausencia y ve el diálogo + la solicitud queda aprobada; gate e2e verde.
- **CI:** typecheck/lint/build + integración RLS + e2e verdes.

---

## 6. Pasos operativos

1. Rama nueva desde `main`.
2. Inspección (§3) → A + B + C → tests.
3. `commit → push → GitHub Actions`. CI de verdad (3 jobs).
4. **Versionar** `docs/prompts/FB-ADJ-01.md`.
5. Reportar: hallazgo de inspección (¿con/sin migración?), diff de nav + actions + Constitución, estado de CI, `git status`.

**No mergear.** Merge gateado por Luciano tras auditoría (`FB-ADJ-AUD-01` — es cambio de lógica: auto-aprobación + excepción al principio). Si la inspección concluye que hace falta migración, se suma runbook.

---

## 7. Definition of Done

- [ ] Inspección reportada; veredicto con/sin migración (preferencia sin; flag si atomicidad exige RPC).
- [ ] "Formularios" → "Ingreso" (etiqueta), es-AR.
- [ ] Admin ve y envía Ausencia/Pasaje **para sí**; diálogo de confirmación (solo admin) con el copy acordado.
- [ ] Auto-aprobación: solicitud de admin queda `aprobado`, calendario escrito, `reviewed_by`=admin, `audit_log` completo; sin `pendiente` en Aprobaciones; sin huérfanas ante fallo.
- [ ] No-retroactiva aplica al admin; no-admin sin cambios; admin-para-sí (no por otros).
- [ ] Contrato return-based; errores visibles.
- [ ] Constitución actualizada (§4 + excepción al principio + renombre) con bump menor y "Decisiones cerradas".
- [ ] Tests (integración `asUser` + e2e) verdes; CI 3 jobs verdes.
- [ ] `docs/prompts/FB-ADJ-01.md` versionado; `git status` limpio.
- [ ] Si hubo migración: NO aplicada a prod (runbook aparte).
