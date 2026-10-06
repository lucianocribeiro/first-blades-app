```text
# FB-PI-AUD-04 — Auditoría del diff de FB-PI-04 (PR #52)

- **Fecha:** 2026-10-06
- **Rama auditada:** `feat/fb-pi-04-export-calendario`
- **Base:** `main` @ `8b38171`
- **HEAD auditado:** `0df5f62`
- **Referencias:** `docs/constitucion.md` v0.8 + `docs/prd-calendario-export-import.md` + `docs/prompts/FB-PI-04.md` + `docs/prompts/FB-PI-04-B.md` + `docs/audits/FB-PI-04-INSPECT.md`

## Resultado

1 hallazgo mayor. El export pagina las asignaciones, pero no pagina la lectura del conjunto de empleados que alimenta las filas del archivo.

HALLAZGO 1 — La lectura de empleados del export queda expuesta al tope de 1000
Severidad: Mayor
Archivo:lib/rotation/calendario-export.ts:70-76
Qué: `fetchCalendarioExportData` lee `profiles` con `.select(...).eq('status', 'activo').in('role', ['empleado', 'supervisor'])` sin `fetchAllRows()` ni `.range()`. Con más de 1000 empleados/supervisores activos, PostgREST devuelve solo las primeras 1000 sin error; el export arma filas únicamente para ese subconjunto y además consulta asignaciones solo para esos IDs. El archivo queda incompleto sin señal visible, aunque la lectura de `rotation_assignments` sí esté paginada.
Por qué: Incumple la cobertura exigida por el prompt (una fila por cada empleado en alcance × día), la corrección de datos que motiva el helper compartido y el foco 4 de lectura paginada. El alcance del export no establece un límite de 1000 empleados; los inactivos y admins deben excluirse, pero todos los empleados y supervisores activos deben estar representados.
Sugerencia: Hacer que la lectura de perfiles también use `fetchAllRows()` con los filtros actuales preservados y un orden total estable; agregar una prueba con más de 1000 perfiles que verifique que todos llegan al archivo.

## Confirmaciones

- Las asignaciones usan el helper compartido `fetchAllRows`, sin loop paralelo, con orden total por `user_id, fecha` sobre `UNIQUE(user_id, fecha)`.
- Se preservan los filtros de negocio: `status = 'activo'`, roles `empleado`/`supervisor`, sin admins; se usa email, no DNI.
- El mapeo enum↔etiqueta está en un módulo único, toma copy desde `/lib/copy`, cubre todos los enums y tiene inversas para el import. La etiqueta es “Fuera del trabajo” en la app, el archivo y la hoja de Referencia.
- El workbook probado contiene filas vacías, desplegables, bloqueo de email/nombre/fecha y combinaciones válidas en Referencia. El código declara que los desplegables son comodidad y no control server-side.
- `exceljs` queda del lado servidor: el build terminó correctamente y no aparece en los chunks estáticos del cliente. `export-actions.ts` usa `requireAdmin()` y `createServerClient()`; no hay `createAdminClient()` en la feature.
- No hay ruta/parser/previsualización/migración de import en el diff. No se audita la verificación manual en Google Sheets.

## Verificación

- `npm run typecheck` — OK.
- Tests focalizados — OK, 4 archivos / 74 tests.
- `npm test` — OK, 66 archivos / 879 tests.
- `npm run lint` — OK, sin warnings ni errores.
- `npm run build` — OK.
- `npm run test:integration` — no verificable localmente: no hay PostgreSQL disponible; Vitest saltó 24 archivos / 423 tests, incluidos los 2 de `tests/integration/calendario-export.test.ts`.
- `npm run test:e2e -- --list` — OK; lista 35 tests: 31 existentes + 4 del export.
```

---

> **Nota del Developer — triage (FB-PI-04-C):**
>
> - **Hallazgo único, severidad Mayor (lectura de `profiles` sin paginar en `fetchCalendarioExportData`): resuelto en este mismo PR (#52), sin re-auditoría** (§1.1, nivel de rigor de features). La lectura ahora pasa por `fetchAllRows()` con los filtros intactos (`status = 'activo'`, roles `empleado`/`supervisor`, sin admins) y un orden total estable (`full_name`, `email`, `id`). Test nuevo en `tests/unit/lecturas-completas.test.ts`, con el cliente simulado de FB-PI-05 que corta en 1000 filas sin error: 1100 perfiles llegan a la lectura y al archivo (2200 filas en 2 días). Sin `fetchAllRows()` el test devuelve 1000 y queda en rojo (verificado).
> - **Otras lecturas del diff:** el PR agrega solo dos lecturas de tablas, `profiles` y `rotation_assignments`, y ambas usan `fetchAllRows()`.
> - **Integración:** Codex no pudo correr `npm run test:integration` en local por falta de PostgreSQL. Ese job **corrió verde en CI** sobre `0df5f62` (24 archivos, 423 tests, incluidos los 2 de `calendario-export.test.ts`) y vuelve a correr sobre la nueva cabeza. CI es la compuerta autoritativa.
> - **Nota lateral, sin acción en este PR:** con más de ~1000 perfiles en alcance, la lectura de asignaciones manda todos los IDs en `.in('user_id', …)` y el URL podría pasar el límite del gateway. Eso falla **con error**, no en silencio: el export devuelve `{ ok: false }` con mensaje es-AR. Ya está registrado en `docs/audits/FB-PI-05-DIAG.md` §6.5.
