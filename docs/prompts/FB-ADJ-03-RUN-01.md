# FB-ADJ-03-RUN-01 — Runbook de `db push` de la migración 0021

- **ID:** FB-ADJ-03-RUN-01
- **Destino:** Claude Code (preflight) + **Luciano (ejecución del push)**
- **Depende de:** `FB-ADJ-03-MERGE-44` mergeado y `main` en verde

---

## Qué se va a aplicar

`0021_employee_status_sin_pendiente.sql`. Producción pasa de **0020** a **0021**.

**Recrea el tipo `employee_status`** con dos valores y migra `profiles.status`. Es la operación más delicada del ajuste: toca el tipo de una columna de la tabla de perfiles, en producción, sin staging.

**Precondición confirmada por la inspección en vivo:** cero filas con `status = 'pendiente'` (3 perfiles, los 3 `activo`). El preflight la **vuelve a verificar** — el dato es de hace días y el push es irreversible.

---

## Parte A — Preflight (Claude Code)

Solo lectura. **No ejecutes el push.**

### A.1 — Migraciones

`supabase migration list`. Local = Remote hasta **0020**, `0021` solo en Local, **ninguna otra pendiente**. Si aparece más de una, frená.

### A.2 — Reverificar la precondición

**`SELECT status, count(*) FROM profiles GROUP BY status;`**

Si aparece **una sola fila con `pendiente`, frená.** La migración fallaría o dejaría datos en un estado que nadie previó.

### A.3 — Snapshot pre-push

Versioná en `docs/prompts/FB-ADJ-03-RUN-01-SNAPSHOT.md`:

1. `employee_status` actual: valores y orden.
2. `profiles.status`: tipo, nullabilidad, **default** (transcripto literal — es lo que hay que ver reaparecer después).
3. Conteo por estado (el de A.2).
4. Dependencias del tipo vía `pg_depend`: la lista completa, para comparar después.
5. Confirmación de que no hay policies, funciones, vistas, índices ni checks que referencien el tipo.

### A.4 — Reporte

Resultado de `migration list`, el conteo por estado, la ruta del snapshot, y una **recomendación explícita de avanzar o frenar**.

---

## Parte B — El push (lo corre Luciano)

1. `cd /Users/lucianocr/Desktop/Dev/first-blades-app/`
2. `git checkout main && git pull`
3. `supabase db push`
4. **Antes de confirmar, leé la lista.** Tiene que decir **`0021` y nada más**. Si aparece otra cosa, cancelá y avisá.
5. Confirmá y dejá terminar.
6. Copiá **toda** la salida, incluidos warnings.
7. `supabase migration list` y copiá el resultado.

**Si falla a mitad, no lo repitas.** Pasá el error tal cual. Una recreación de tipo a medio aplicar puede dejar la columna en un estado raro y hay que mirarlo antes de tocar nada.

## Definition of Done

- [ ] `migration list` de preflight reportado.
- [ ] **Conteo por estado reverificado**, cero en `pendiente`.
- [ ] `docs/prompts/FB-ADJ-03-RUN-01-SNAPSHOT.md` versionado.
- [ ] `docs/prompts/FB-ADJ-03-RUN-01.md` versionado.
- [ ] Recomendación explícita de avanzar o frenar.
- [ ] Push ejecutado por Luciano, con la salida completa capturada.

## Qué sigue

`FB-ADJ-03-RUN-01-VERIF` — verificación de catálogo y regen de `types.ts`.
