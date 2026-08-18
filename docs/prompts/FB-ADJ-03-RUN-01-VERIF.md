# FB-ADJ-03-RUN-01-VERIF — Verificación de catálogo post-push

- **ID:** FB-ADJ-03-RUN-01-VERIF
- **Destino:** Claude Code
- **Depende de:** `FB-ADJ-03-RUN-01` ejecutado — la `0021` ya corrió en producción

---

## Objetivo

Confirmar, **mirando el catálogo**, que la recreación del tipo dejó todo como esperábamos. Solo lectura. Referencia: `docs/prompts/FB-ADJ-03-RUN-01-SNAPSHOT.md`.

## 1. El tipo `employee_status`

- Existe **con el nombre original** (no quedó `employee_status_new` ni el viejo dando vueltas).
- Exactamente **dos valores**: `activo`, `inactivo`. Transcribí valores y orden.
- **No existe ningún tipo huérfano** de la recreación. Listá los tipos del esquema y confirmalo.

## 2. `profiles.status` — el punto crítico

- Tipo `employee_status`.
- `NOT NULL`.
- **`DEFAULT 'activo'` presente.** Transcribilo y compará **literal** contra el snapshot. Si el default se perdió, cualquier alta futura sin `status` explícito falla, y eso no se nota hasta que alguien crea un usuario.

## 3. Los datos

`SELECT status, count(*) FROM profiles GROUP BY status;`

Mismo resultado que el snapshot: **3 perfiles, los 3 `activo`**. Ninguna fila perdida ni cambiada.

## 4. Dependencias

`pg_depend` sobre el tipo: las mismas tres estructurales del snapshot (columna, default, array implícito). Nada de más, nada de menos.

Y confirmá que no aparecieron policies, funciones, vistas, índices ni checks referenciando el tipo.

## 5. Nada de contrabando

- `migration list`: Local = Remote hasta **0021**.
- Ninguna tabla, función, policy o enum fuera de lo declarado apareció o desapareció. Compará el inventario contra el snapshot.
- ⚠️ **Verificá que `approval_status` siga intacto** con sus tres valores, incluido `pendiente`. Es otro dominio y no debía tocarse.

## 6. Regen de `types.ts`

`supabase gen types typescript --linked`, con el **CLI real**. **Diff cero** contra el archivo commiteado.

Esto valida la edición a mano del build. Si el diff no es cero, **reportá el diff completo antes de tocar nada**. Si el regen requiere Docker y no está disponible, decilo y frená: la validación queda pendiente, no dada por hecha.

## Definition of Done

- [ ] Los 6 bloques verificados contra el snapshot, con las definiciones transcriptas.
- [ ] `docs/prompts/FB-ADJ-03-RUN-01-VERIF.md` versionado.
- [ ] Informe en `docs/prompts/FB-ADJ-03-RUN-01-VERIF-REPORT.md`.
- [ ] Diff cero del regen, o el diff completo reportado.
- [ ] Rama, `commit → push`, CI en verde, PR abierta sin mergear.
- [ ] **Veredicto explícito** de si producción quedó como se esperaba, y cualquier divergencia por chica que sea.

## Si algo se desvía

Si el default no está, si falta una fila, o si quedó algún tipo huérfano: **frená y reportá**. No intentes revertir por tu cuenta.
