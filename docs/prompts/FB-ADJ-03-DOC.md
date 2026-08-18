# FB-ADJ-03-DOC — Corrección de ID y versionado de la inspección

- **ID:** FB-ADJ-03-DOC
- **Tipo:** ajuste inter-fase, doc-only (no toca código de feature)
- **Destino:** Claude Code
- **Reemplaza el encabezado de:** el prompt entregado como `FB-ADJ-01`
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1)

---

## 1. Corrección de ID

El prompt del ajuste se entregó como `FB-ADJ-01`, pero **`FB-ADJ-01` y `FB-ADJ-02` ya están usados** por el ajuste inter-fase anterior (renombre "Ingreso" + admin auto-envío). Error del Developer al numerar; lo detectó Claude Code antes de versionar.

**El ID correcto es `FB-ADJ-03`.**

- Versioná el prompt del ajuste como `docs/prompts/FB-ADJ-03.md`, con el encabezado corregido (ID, y una nota de una línea diciendo que se entregó con el ID equivocado y se corrigió antes de versionarse).
- Usá `FB-ADJ-03` en commits, rama y PR.
- **Migración: `0021`.**

## 2. Versionar el informe de inspección

La inspección de la Parte 0 se pidió embebida en el prompt del ajuste, sin su propio entregable. Fue un error: el relevamiento quedó **solo en el chat**, y por la regla de tracking tiene que estar en el repo.

Escribí **`docs/prompts/FB-ADJ-03-INSPECT-REPORT.md`** con el resultado completo de la inspección que ya hiciste, con los seis bloques:

1. Enum `employee_status` (valores, orden) y `profiles.status` (nullabilidad, default).
2. Conteo de filas con `pendiente` (0).
3. **Dependencias del tipo**, incluidas las verificaciones que dieron **sin resultados**: policies, funciones `SECURITY DEFINER`, vistas, índices, check constraints. Que quede escrito qué se descartó y con qué consulta — es lo que justifica que la migración sea simple.
4. Referencias a `pendiente` en el código, con archivo y línea.
5. Todo lo relacionado con "Ingreso" / `formularios`, con archivo y línea.
6. Estado de migraciones (Local = Remote en 0020) y el hueco del drift detector (no chequea valores exactos del enum).

Transcribí definiciones y consultas donde corresponda. Este informe es la evidencia de por qué la migración `0021` puede ser tan chica.

## 3. Agregados al alcance del ajuste

Confirmados por el Developer, van dentro de `FB-ADJ-03`:

- **`docs/constitucion.md`:** corregí las dos entradas que quedan desactualizadas — la fila del módulo "Ingreso" (línea ~89) y `employee_status` con tres valores. **Solo la corrección factual.** El bump de versión de la constitución va en su propia pieza, al cierre.
- **Drift detector:** agregá el check de valores exactos de `employee_status`, como propusiste. Hoy solo verifica nombres de tipos, no sus valores.

## 4. Recordatorio de proceso

**Los prompts los escribe el Developer.** Preguntar antes de asumir un ID fue exactamente lo correcto: seguí haciéndolo.

Y todo lo que se te pide va como `.md` versionado, sin excepción — incluidos los pasos operativos como este. Si recibís una instrucción suelta por chat que debería ser un prompt, **pedila como archivo**.

## Definition of Done

- [ ] `docs/prompts/FB-ADJ-03.md` versionado, con el ID corregido y la nota del error de numeración.
- [ ] `docs/prompts/FB-ADJ-03-INSPECT-REPORT.md` versionado, con los seis bloques.
- [ ] **`docs/prompts/FB-ADJ-03-DOC.md` versionado — este archivo.**
- [ ] Rama y PR con el ID `FB-ADJ-03`.
- [ ] Los dos agregados del punto 3 incluidos en el alcance del ajuste.