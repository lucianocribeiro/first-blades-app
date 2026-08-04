# FB-ADJ-01-DOC — Addendum (doc-only): corregir "excepción A5" en CLAUDE.md

> **Ajuste inter-fase · Addendum de FB-ADJ-01 · Doc-only.** Para Claude Code, vía Luciano.
> Completa la honestidad de la fuente de verdad: FB-ADJ-01 actualizó `docs/constitucion.md` pero **no** `CLAUDE.md`, que quedó inconsistente. Se commitea **sobre la misma branch de FB-ADJ-01**, para que entre en el mismo PR **antes** de la auditoría.

---

## 1. Objetivo

`CLAUDE.md` describe la "excepción A5" diciendo que `uploadDocumentForEmployee` es **"el único path de auto-aprobación"**. Con FB-ADJ-01, **admin-para-sí** de Solicitud de Ausencia y Pasaje es un **segundo** path de auto-aprobación. Corregir la nota para que refleje ambos, consistente con la Constitución **v0.7.1**.

## 2. Alcance

Sólo `CLAUDE.md` (la nota de excepción A5). **No** tocar código, tests, ni otras secciones.

- Reemplazar "el único path de auto-aprobación" por una redacción que liste **los dos** paths de auto-aprobación existentes:
  1. `uploadDocumentForEmployee` — el admin carga un documento por un empleado (excepción A5, ya existente).
  2. **Admin-para-sí:** las Solicitudes de Ausencia y Pasaje enviadas por un admin para sí mismo se auto-aprueban (FB-ADJ-01; ver §4 y la excepción al principio "nada se autoactiva" en `docs/constitucion.md` v0.7.1).
- Mantener el estilo/es-AR de `CLAUDE.md`; edición quirúrgica.

## 3. Pasos operativos

1. Sobre la branch de FB-ADJ-01, editar `CLAUDE.md`.
2. `commit → push → GitHub Actions`. Confirmar CI verde (3 jobs; es doc, no debería afectar nada).
3. Reportar el diff de la nota y confirmar que el PR sigue CLEAN.

**No mergear.** La auditoría (`FB-ADJ-AUD-01`) corre sobre el PR ya con este addendum incluido.

## 4. Definition of Done

- [ ] La nota de excepción A5 en `CLAUDE.md` refleja **los dos** paths de auto-aprobación, consistente con la Constitución v0.7.1.
- [ ] Sólo se tocó `CLAUDE.md`; CI verde; PR CLEAN.
- [ ] Diff reportado.
