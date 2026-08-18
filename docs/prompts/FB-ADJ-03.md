# FB-ADJ-03 — Eliminación del módulo "Ingreso" y del estado `pendiente`

- **ID:** FB-ADJ-03
- **Tipo:** ajuste inter-fase (no pertenece a una fase). Incluye **migración**.
- **Destino:** Claude Code
- **Fuente de verdad:** `docs/constitucion.md` (v0.7.1)
- **Skills:** `supabase-migration`, `dod-checklist`

> **Nota de numeración:** este prompt se entregó originalmente como `FB-ADJ-01`, ID ya usado por el ajuste inter-fase anterior (renombre "Formularios" → "Ingreso" + admin auto-envío, migración 0019). Error del Developer al numerar, detectado por Claude Code antes de versionar. El ID correcto es `FB-ADJ-03`; el contenido no cambió. Ver `FB-ADJ-03-DOC.md`.

---

## Contexto

Luciano validó con el cliente: **el módulo "Ingreso" no se va a construir.** Se elimina ahora, antes de que la app entre en uso.

Como consecuencia, el estado `pendiente` de usuario pierde su único caso de uso previsto (precargar candidatos sin cuenta). **Luciano decidió eliminar el valor del enum**, no solo dejarlo sin uso.

⚠️ Postgres **no permite** quitar un valor de un enum con un `ALTER TYPE ... DROP VALUE`. Hay que recrear el tipo y migrar la columna. Por eso esta pieza lleva ceremonia completa de migración: auditoría, merge, runbook gateado y verificación de catálogo.

---

## PARTE 0 — Inspección previa (obligatoria, antes de escribir una línea de SQL)

Solo lectura, vía MCP de Supabase. **Frená y reportá antes de escribir la migración.**

1. **El enum de estado de usuario:** nombre real del tipo, todos sus valores, y la columna de `profiles` que lo usa (nombre, nullabilidad, **default**).
2. **Filas con `pendiente`:** cuántas hay. **Si hay alguna, frená.** Luciano mencionó usuarios de prueba a purgar; hay que resolverlos antes, no arrastrarlos en la migración.
3. **Todas las dependencias del tipo** (`pg_depend`): policies de RLS, funciones (`is_admin()`, `auth_role()`, RPCs), vistas, índices, constraints, defaults. Listá cada una con su definición transcripta. **Este es el punto crítico:** recrear un tipo con dependencias colgando falla o rompe algo.
4. **Referencias a `pendiente` en el código:** `app/`, `lib/`, tests, `types.ts`, copy.
5. **Todo lo relacionado con "Ingreso":** ítem de menú, ruta, página placeholder, componentes, copy, tests, referencias en docs.
6. Última migración aplicada y el número siguiente. `migration list` Local=Remote.

Reportá todo esto **antes** de continuar. Si alguna dependencia hace que el cambio sea más invasivo de lo previsto, decilo: puede que convenga replantear.

---

## PARTE 1 — Eliminar "Ingreso"

Sacá **todo**, no solo el link:

- Ítem del menú en el shell.
- **La ruta y la página.** Si queda la página, sigue siendo accesible por URL aunque no haya link.
- Componentes, copy y tests exclusivos del módulo.
- Referencias en documentación del repo.

No toques nada que se comparta con otros módulos.

## PARTE 2 — Migración: quitar `pendiente` del enum

Solo después de que la inspección esté reportada y no haya filas con `pendiente`.

Enfoque (ajustalo a lo que encuentre la inspección):

1. Crear el tipo nuevo sin `pendiente`.
2. Quitar el default de la columna.
3. `ALTER TABLE ... ALTER COLUMN ... TYPE nuevo USING ...::text::nuevo`.
4. Restaurar el default (`activo`).
5. Recrear **todas** las dependencias que haya que recrear, con su definición original salvo el cambio de tipo.
6. Eliminar el tipo viejo y renombrar el nuevo al nombre original.

Requisitos:

- **Delta-only**, comentada, un solo archivo de migración.
- **Ninguna dependencia puede quedar apuntando al tipo viejo.** Si algo no se puede recrear limpio, **frená**.
- Si hay funciones `SECURITY DEFINER` entre las dependencias, se recrean **re-aseverando** owner, `search_path`, `GRANT` a `authenticated` y `REVOKE` de `anon`/`PUBLIC` — y la verificación de catálogo post-push es obligatoria.
- **No corras `db push`.** Va por runbook gateado.

## PARTE 3 — Código y tests

- Sacá `pendiente` de todo el código, tipos y copy.
- **El gate de acceso** ya bloquea todo lo que no sea `activo`: confirmá que sigue funcionando con dos valores en vez de tres, y que ningún test dependía de `pendiente` como caso de prueba.
- Drift detector actualizado: el enum con sus valores exactos, y las dependencias recreadas.
- `types.ts`: si no tenés Docker, editalo a mano y **decilo explícitamente** — el regen `--linked` post-push tiene que dar diff cero.

---

## Definition of Done

- [ ] Inspección de la Parte 0 reportada **antes** del SQL.
- [ ] Cero filas con `pendiente` confirmado.
- [ ] "Ingreso" eliminado completo: menú, ruta, página, componentes, copy, tests, docs.
- [ ] Migración escrita, delta-only, con todas las dependencias recreadas.
- [ ] Drift detector actualizado; tests verdes.
- [ ] `docs/prompts/FB-ADJ-01.md` versionado.
- [ ] `commit → push`, CI en verde los 3 jobs.
- [ ] PR abierta, sin mergear.
- [ ] **`db push` NO ejecutado.** Confirmalo.
- [ ] Reporte de cierre: rama, PR, CI, **la lista completa de dependencias que hubo que recrear**, y cualquier desvío.

## Si algo se desvía

Frená y reportá si: hay filas con `pendiente`, alguna dependencia no se recrea limpio, o el alcance real resulta mayor al previsto. Este cambio es cosmético en su beneficio y no vale la pena forzarlo si sale caro — mejor saberlo antes que a mitad de camino.

## Qué sigue

Auditoría de Codex (foco: que ninguna dependencia quede rota y que las funciones `SECURITY DEFINER` conserven sus permisos), merge, runbook de `db push` con verificación de catálogo, y regen de `types.ts`.