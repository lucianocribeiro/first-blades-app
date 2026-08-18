# FB-ADJ-03-DOC-02 — Carga de archivos y aclaración de alcance

- **ID:** FB-ADJ-03-DOC-02
- **Tipo:** ajuste inter-fase, doc-only (no toca código de feature)
- **Destino:** Claude Code
- **Complementa a:** `FB-ADJ-03-DOC.md`
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1)

---

## 1. Archivos cargados

Luciano guardó en `docs/prompts/`, **untracked** hasta que los versiones:

- **`FB-ADJ-03.md`** — el prompt del ajuste, con el encabezado ya corregido al ID correcto y la nota del error de numeración incluida. **No hay que renombrarlo ni editarle el encabezado:** llega listo.
- **`FB-ADJ-03-DOC.md`** — la corrección de numeración y el pedido de versionar el informe de inspección.
- **`FB-ADJ-03-DOC-02.md`** — este archivo.

⚠️ **`FB-ADJ-01.md`, `FB-ADJ-01-DOC.md`, `FB-ADJ-02.md` y `FB-ADJ-02-DOC.md` pertenecen al ajuste inter-fase anterior** (renombre "Formularios" → "Ingreso" + admin auto-envío, migración 0019). Están trackeados y **no se tocan**. Lo mismo para `docs/audits/FB-ADJ-AUD-01.md` y `FB-ADJ-AUD-02.md`.

## 2. Aclaración de alcance

Claude Code preguntó si el ajuste era sobre el módulo "Ingreso" o sobre el enum `employee_status`. **Es sobre los dos, y son una sola decisión.**

El cliente descartó el módulo "Ingreso". El valor `pendiente` de `employee_status` existía justamente para ese módulo — precargar candidatos sin cuenta. Sin módulo, el valor no tiene ningún caso de uso, y Luciano decidió eliminarlo del enum en lugar de dejarlo muerto.

Están en las Partes 1 y 2 de `FB-ADJ-03.md`. La confusión vino de que el prompt se describió por chat antes de entregarse como archivo: Claude Code nunca lo había visto. **Preguntar antes de asumir fue lo correcto.**

## 3. Recordatorio de proceso

**Todo lo que se le pide a Claude Code va como `.md` versionado, sin excepción.** Este archivo existe porque las instrucciones de carga y la aclaración de alcance se dieron primero como mensaje suelto en el chat, que es exactamente lo que la regla prohíbe. Corregido acá.

Si recibís una instrucción suelta que debería ser un prompt, **pedila como archivo**.

## Definition of Done

- [ ] `docs/prompts/FB-ADJ-03.md` versionado, tal como llegó (encabezado ya corregido — verificá que diga `FB-ADJ-03` y que tenga la nota de numeración; si no, avisá).
- [ ] `docs/prompts/FB-ADJ-03-DOC.md` versionado.
- [ ] **`docs/prompts/FB-ADJ-03-DOC-02.md` versionado — este archivo.**
- [ ] `docs/prompts/FB-ADJ-03-INSPECT-REPORT.md` versionado (hoy untracked).
- [ ] Los cuatro archivos del ajuste anterior sin tocar.
- [ ] Rama y PR con el ID `FB-ADJ-03`.
- [ ] Seguí con las Partes 1, 2 y 3 de `FB-ADJ-03.md`.