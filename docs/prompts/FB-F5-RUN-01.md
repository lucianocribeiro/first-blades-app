# FB-F5-RUN-01 — Runbook de `db push` de la migración 0020

- **ID:** FB-F5-RUN-01
- **Fase:** 5
- **Destino:** Claude Code (preflight) + **Luciano (ejecución del push en su terminal)**
- **Depende de:** `FB-F5-MERGE-39` mergeado y `main` en verde
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1)

---

## Qué se va a aplicar

`0020_fase5_procedimientos.sql`. Producción está en **0019** y pasa a **0020**.

Contenido: renombre de columnas de `procedures` al español · enum `procedure_estado` + columna `estado` · CHECK `procedures_contenido_presente` · reemplazo de la RLS de `procedures` · tres RPCs `SECURITY DEFINER` con auditoría atómica · **`REVOKE` sobre `log_audit()`** · bucket `procedimientos` con sus policies · `motivo_baja` y `fecha_baja` en `profiles`.

**Es la única acción irreversible de la fase. No hay staging. La base de producción es la única que existe.**

⚠️ El punto más delicado es el `REVOKE` sobre `log_audit()`: se modifican los permisos de una **función que ya existe en producción**. Por eso el snapshot pre-push y la verificación de catálogo post-push son obligatorios y no opcionales.

---

## Parte A — Preflight (Claude Code, antes del push)

Todo de solo lectura. **No ejecutes el push.**

### A.1 — Estado de migraciones

`supabase migration list`. Reportá la tabla completa. Tiene que mostrar:

- Local y Remote coincidentes hasta **0019**.
- **`0020` presente en Local y ausente en Remote.**
- **Ninguna otra migración pendiente.** Si aparece más de una, **frená**: significa que algo no está donde creemos.

### A.2 — Snapshot pre-push del catálogo

Vía MCP de Supabase (solo lectura), capturá y **versioná** en `docs/prompts/FB-F5-RUN-01-SNAPSHOT.md`:

1. **`log_audit()`** — estado actual: `proowner`, `prosecdef`, `proconfig`, `proacl`. Este es el objeto que cambia; sin la foto de antes no se puede comparar el después.
2. **Molde de función hermana** — el mismo conjunto de campos para `resolver_ausencia_request` y `crear_aprobar_ausencia_admin`. Sirven de patrón esperado para las tres RPCs nuevas, que se crean de cero y por lo tanto no tienen "antes" propio.
3. **Estado de `procedures`**: columnas actuales (en inglés), constraints, policies, y el **conteo de filas** (esperado: 0).
4. **Buckets de Storage existentes**, para confirmar que `procedimientos` todavía no existe.
5. Confirmación de que `motivo_baja` y `fecha_baja` **no** existen en `profiles`.

El snapshot es la referencia contra la que se compara todo después del push. Sin él, la verificación posterior no vale.

### A.3 — Reporte de preflight

Reportá: resultado de `migration list`, ruta del snapshot versionado, y **una recomendación explícita de avanzar o frenar**. Si algo no cuadra, frená: no dejes la decisión implícita.

---

## Parte B — El push (lo corre Luciano)

La contraseña de producción no toca ninguna sesión de herramienta. Estos pasos son para vos, Luciano:

1. Abrí una terminal en `/Users/lucianocr/Desktop/Dev/first-blades-app/`.
2. `git checkout main && git pull` — confirmá que estás en `main` actualizado, con `0020` presente.
3. Corré `supabase db push`.
4. **Antes de confirmar**, el CLI lista qué va a aplicar. **Leelo.** Tiene que decir **`0020` y nada más**. Si lista otra migración, cancelá y avisá: es la señal de que hay algo aplicado o pendiente fuera de lo previsto.
5. Confirmá y dejá que termine.
6. Copiá **toda la salida** del comando, incluidos warnings.
7. Corré `supabase migration list` y copiá el resultado. Tiene que mostrar Local = Remote hasta 0020.

Si el push falla a mitad de camino, **no lo vuelvas a correr.** Pasá el error tal cual y lo evaluamos antes de tocar nada.

---

## Definition of Done de esta parte

- [ ] `migration list` de preflight reportado, con `0020` como única pendiente.
- [ ] `docs/prompts/FB-F5-RUN-01-SNAPSHOT.md` versionado, con los cinco puntos de A.2.
- [ ] `docs/prompts/FB-F5-RUN-01.md` versionado (este archivo).
- [ ] Recomendación explícita de avanzar o frenar.
- [ ] Push ejecutado por Luciano, con la salida completa y el `migration list` posterior capturados.

## Qué sigue

`FB-F5-RUN-01-VERIF` — verificación de catálogo post-push y regeneración de `types.ts`. **La migración no se da por cerrada hasta que esa verificación pase.**
