# FB-F5-RUN-01-VERIF — Verificación de catálogo post-push

- **ID:** FB-F5-RUN-01-VERIF
- **Fase:** 5
- **Destino:** Claude Code
- **Depende de:** `FB-F5-RUN-01` ejecutado — el push de `0020` ya corrió en producción
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1)

---

## Objetivo

Confirmar, **mirando el catálogo de la base y no la salida del CLI**, que producción quedó exactamente como esperábamos y que el push no movió nada de contrabando. La migración no se da por cerrada hasta que esto pase.

Todo de solo lectura, vía MCP de Supabase. **No escribas en la base.**

Referencia de comparación: `docs/prompts/FB-F5-RUN-01-SNAPSHOT.md`.

---

## 1. `log_audit()` — el objeto que cambió (crítico)

Compará contra el snapshot pre-push, campo por campo:

- `proowner` — **sin cambios** respecto del snapshot.
- `prosecdef` — **sin cambios**, sigue `SECURITY DEFINER`.
- `proconfig` — **sin cambios**, sigue con `search_path=public`.
- `proacl` — **cambió, y es el único cambio esperado**: sin `anon`, sin `authenticated`, sin `PUBLIC`. Debería quedar `postgres=X/postgres`, `service_role=X/postgres`.
- **El cuerpo de la función sin cambios.** Comparalo contra el snapshot.

**Cualquier divergencia fuera del `proacl` → frená y reportá.** No sigas con el regen de tipos ni des la migración por cerrada.

## 2. Las tres RPCs nuevas

Para `crear_procedimiento`, `actualizar_procedimiento` y `archivar_procedimiento`, verificá contra el **molde** de las funciones hermanas del snapshot:

- `proowner` = `postgres`
- `prosecdef` = true
- `proconfig` con `search_path=public`
- `proacl` = `authenticated=X/postgres`, `postgres=X/postgres`, `service_role=X/postgres`. **Sin `anon`.**

`service_role` aparece por el `ALTER DEFAULT PRIVILEGES` de plataforma (migración 0013), no por un grant de `0020`. Es esperado.

## 3. `procedures`

- Columnas en español: `titulo`, `contenido_texto`, `file_path`, `categoria`. Ninguna con el nombre viejo.
- Columna `estado`, tipo `procedure_estado`, `NOT NULL DEFAULT 'vigente'`.
- Enum `procedure_estado` con exactamente dos valores: `vigente`, `archivado`.
- CHECK `procedures_contenido_presente` presente, con la definición con `[[:space:]]`. Transcribila.
- Policies: `procedures_select_all` **no existe**; están `procedures_select` y `procedures_write_admin`. Transcribilas.
- Conteo de filas: 0.

## 4. Storage

- Bucket `procedimientos` existe y es **privado**.
- Sus policies presentes, con escritura solo admin y lectura para autenticados.
- El bucket `documents` **sin cambios** respecto del snapshot.

## 5. `profiles`

- `motivo_baja` (text, nullable) y `fecha_baja` (date, nullable) presentes.
- Ninguna otra columna de `profiles` modificada.

## 6. Nada de contrabando

- `migration list`: Local = Remote hasta **0020**, y ninguna migración inesperada.
- Ninguna tabla, función, policy o enum **fuera de los declarados en `0020`** apareció o desapareció. Compará el inventario contra el snapshot.

## 7. Regen de `types.ts` — la validación pendiente

`supabase gen types typescript --linked`, con el **CLI real** (no el proxy MCP: genera solo el schema `public` y omite `graphql_public`, así que su salida cruda no es diffeable byte a byte).

**El resultado tiene que ser diff cero** contra el `supabase/types.ts` commiteado.

Esto valida la edición a mano que hizo falta por no tener Docker local. **Si el diff no es cero:** reportá el diff completo antes de tocar nada. Es información sobre una divergencia entre lo que creíamos que estábamos escribiendo y lo que realmente quedó en la base, no un archivo para corregir en silencio.

Si el regen requiere Docker y no está disponible, **decilo y frená** ahí: la validación queda explícitamente pendiente y hay que resolverla, no darla por hecha.

---

## Definition of Done

- [ ] Los 7 bloques verificados contra el snapshot, con las definiciones transcriptas.
- [ ] `docs/prompts/FB-F5-RUN-01-VERIF.md` versionado (este archivo).
- [ ] Informe de verificación versionado en `docs/prompts/FB-F5-RUN-01-VERIF-REPORT.md`, con el resultado de cada bloque y las transcripciones.
- [ ] Diff cero del regen de `types.ts`, o el diff completo reportado si no lo es.
- [ ] Rama, `commit → push`, CI en verde. PR abierta sin mergear (el merge va con su prompt).
- [ ] Reporte de cierre: **veredicto explícito de si producción quedó como se esperaba**, y cualquier divergencia por chica que sea.

## Si algo se desvía

Divergencia en el catálogo de una función `SECURITY DEFINER` fuera del cuerpo → **frenar**. Es la regla que existe justamente para el caso de esta migración, que toca los permisos de una función preexistente.

No intentes revertir nada por tu cuenta. Reportá y esperá instrucciones.
