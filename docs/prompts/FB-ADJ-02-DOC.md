# FB-ADJ-02-DOC — Addendum (doc-only): corregir la entrada v0.7.1 de la Constitución

> **Ajuste inter-fase · Addendum de FB-ADJ-02 · Doc-only.** Para Claude Code, vía Luciano.
> Cierra el hallazgo (Media) de `FB-ADJ-AUD-02`: la Constitución describe el mecanismo **viejo** (descartado) del admin auto-envío. **Doc-only → sin re-auditoría** (CI verde + revisar el diff). Se commitea **sobre la misma branch de PR #37**.

---

## 1. Objetivo

La entrada **v0.7.1** de `docs/constitucion.md` (alrededor de la línea 255, en "Decisiones cerradas" y/o §4/§7) todavía dice **"sin migración"** y describe el flujo que **descartamos**: la Server Action crea `pendiente`, invoca la resolver y **borra si falla** (compensación). El fix `FB-ADJ-02` reemplazó eso por una **RPC transaccional** (migración 0019). La Constitución quedó describiendo una arquitectura que ya no existe.

Como la **v0.7.1 todavía no está en `main`** (viaja en este mismo PR #37), se **corrige el texto en el lugar** — no se bumpea otra vez; la v0.7.1 debe describir el estado **final**.

## 2. Alcance

Sólo `docs/constitucion.md` (edición quirúrgica). **No** tocar código, tests ni otras secciones.

Reemplazar la descripción del mecanismo por la arquitectura real:
- El admin auto-envío (Ausencia/Pasaje, **para sí**) se implementa con **migración 0019**: dos funciones `SECURITY DEFINER` transaccionales, `crear_aprobar_ausencia_admin` / `crear_aprobar_pasaje_admin`, que **crean y aprueban en una sola transacción** (reutilizando internamente la resolver existente para la escritura de calendario + audit).
- **Atómico, sin solicitudes huérfanas:** un fallo en cualquier punto revierte todo. **No** hay lógica de compensación/borrado en la Server Action (la action llama a una única RPC).
- Mantener la **excepción acotada** al principio "nada se autoactiva": sólo admin-para-sí; admin-por-otro va a `pendiente`.
- Quitar cualquier "sin migración" que haya quedado; reflejar que esta decisión **sí** incorporó la migración 0019.

Mantener el estilo/es-AR; no reescribir secciones estables.

## 3. Pasos operativos

1. Sobre la branch de PR #37, editar `docs/constitucion.md`.
2. `commit → push → GitHub Actions`. Confirmar CI verde (3 jobs; es doc).
3. Reportar el diff de la entrada corregida y confirmar que el PR sigue CLEAN.

**No mergear.** Sin re-auditoría (doc-only). Tras esto: `FB-ADJ-MERGE-37` → `FB-ADJ-RUN-01`.

## 4. Definition of Done

- [ ] La entrada v0.7.1 de la Constitución describe la migración 0019 + RPC transaccional crear+aprobar atómica, **sin** rastro del mecanismo "sin migración / crear+resolver+borrar".
- [ ] Excepción acotada (admin-para-sí) y renombre "Ingreso" siguen reflejados.
- [ ] Sólo se tocó `docs/constitucion.md`; CI verde; PR CLEAN.
- [ ] Diff reportado.
