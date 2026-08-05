# FB-F5-AUD-03 — Auditoría de Codex

- **ID:** FB-F5-AUD-03
- **PR auditada:** #39
- **Rama:** `fase-5/f5-02-migracion`
- **Fecha:** 2026-08-05
- **Veredicto:** `CON HALLAZGOS BLOQUEANTES`

---

**Hallazgo 1**

- **Severidad:** Medio
- **Ubicación:** [supabase/migrations/0020_fase5_procedimientos.sql](/Users/lucianocr/Desktop/Dev/first-blades-app/supabase/migrations/0020_fase5_procedimientos.sql:76)
- **Evidencia:** el CHECK quedó simétrico y exactamente como fue declarado, pero usa `btrim(...) <> ''` en ambas ramas. `btrim(text)` sin segundo argumento recorta espacios normales, no tabs/saltos de línea; valores como `E'\t'` o `E'\n'` seguirían pasando como “contenido”.
- **Regla violada:** FB-F5-AUD-03 §1: verificar que tabs/saltos de línea no abran un hueco.
- **Recomendación:** cambiar el criterio de presencia para rechazar strings compuestos solo por whitespace, por ejemplo con una expresión basada en `[[:space:]]`, y agregar casos negativos con tab y salto de línea para `contenido_texto` y `file_path`.

**Hallazgo 2**

- **Severidad:** Bajo
- **Ubicación:** [docs/audits/FB-F5-AUD-02.md](/Users/lucianocr/Desktop/Dev/first-blades-app/docs/audits/FB-F5-AUD-02.md:11)
- **Evidencia:** el informe está versionado con el contenido sustancial, pero no verbatim: se perdió el formato exacto emitido (`**Hallazgo 1**`, bullets, backticks, estructura Markdown y link labels). Ejemplo: el archivo tiene `Hallazgo 1` y líneas planas de `Severidad:`, no el bloque Markdown emitido.
- **Regla violada:** FB-F5-AUD-03 §3: `docs/audits/FB-F5-AUD-02.md` debe contener el informe verbatim, sin resumir ni reordenar.
- **Recomendación:** reemplazar el cuerpo del informe por el texto exacto emitido por Codex, manteniendo la cabecera y la nota final si se quieren como envoltorio.

**Controles Limpios**

- No existe `0021`.
- El diff posterior a `54227c1` toca solo los cinco archivos permitidos.
- `types.ts` no cambió en esta pasada.
- No hay cambios posteriores en UI, Server Actions, `requireAuth()` ni validación de contraseña.
- ACL/owner: las tres RPCs nuevas y `log_audit` usan igualdad exacta de ACL; owner literal `'postgres'`; `anon` no aparece. No hay `GRANT service_role` explícito en `0020` para las RPCs nuevas.
- PR #39 está abierta, merge state `CLEAN`, y los 3 jobs de CI están en verde.
- Local: `npm run typecheck` pasó; `npm run test:integration` quedó skipped por falta de PostgreSQL local.

**Veredicto:** `CON HALLAZGOS BLOQUEANTES`

**¿Esta migración está en condiciones de aplicarse a producción?** No. Falta cerrar el hueco de whitespace del CHECK; además, antes del merge debería corregirse el informe versionado para que sea verbatim.

---

Los dos hallazgos de esta auditoría se resolvieron en `FB-F5-04` (misma PR #39, rama `fase-5/f5-02-migracion`).
