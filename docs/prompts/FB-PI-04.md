# FB-PI-04 — Export del calendario a Excel (admin)

- **ID:** FB-PI-04
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-04.md`
- **PRD:** `docs/prd-calendario-export-import.md` (adjunto, commitealo en este PR)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** **ninguna.** Esto es solo lectura. Si creés que hace falta una, frená y reportá.

---

## Encuadre

Primero de **dos PRs**. Este es el **export**: solo lectura, no escribe nada, no puede romper datos. El import va aparte en `FB-PI-05` y ese sí lleva migración.

El orden es deliberado: el export define el formato del archivo, y Luciano lo quiere en la mano para validar que le sirve **antes** de que se construya el import encima. Si el formato tiene que cambiar, que cambie ahora que es barato.

**No construyas nada del import en este PR.** Ni la ruta, ni el parser, ni la previsualización, ni la migración. Sí podés dejar el mapeo etiqueta↔enum en un módulo compartido, porque el import lo va a reusar y duplicarlo sería el error.

---

## Paso 0 — Inspección (obligatorio, con informe versionado)

**No escribas código hasta terminar.** Constitución §1.1: toda inspección produce informe versionado explícito.

Relevá:

1. **Librería de Excel:** ¿hay alguna ya en el repo? Si no, cuál proponés. Requisito duro: tiene que soportar **validación de datos (desplegables)** y bloqueo de celdas. Decilo antes de instalar nada.
2. **Módulo Calendario:** dónde vive la ruta de admin, cómo se consulta hoy `rotation_assignments`, qué helpers existen.
3. **Guard de admin:** cómo se verifica el rol server-side en las rutas de admin (`requireAdmin()` o equivalente) y cómo corta.
4. **`/lib/copy`:** estructura y dónde irían las etiquetas del módulo.
5. **Enums reales en la base:** valores exactos de `estado_dia` y `motivo_ausencia`. Tomalos del esquema, **no de la constitución** — ya detectamos desfasajes de documentación.
6. **Descarga de archivos:** ¿hay algún patrón existente en la app para servir un archivo generado?

**Entregable:** `docs/audits/FB-PI-04-INSPECT.md`, commiteado.

---

## Paso 1 — Generación del archivo

Una fila por **empleado activo** y por **día del rango**, incluidos los días sin ninguna asignación, que salen con el estado vacío.

Columnas, en este orden:

| Columna | Editable | Contenido |
|---|---|---|
| `email` | No, bloqueada | Clave de identificación |
| `nombre` | No, bloqueada | `full_name`, solo orientativo |
| `fecha` | No, bloqueada | `AAAA-MM-DD` |
| `estado` | Sí, desplegable | Trabajando · En franco · En viaje · Período fuera del trabajo · vacío |
| `motivo` | Sí, desplegable | Vacaciones · Licencia médica · Día de trámite · Matrimonio · Fallecimiento · Otros |
| `motivo_otros` | Sí, texto | |
| `notas` | Sí, texto | |

- **Clave: `email`.** No DNI. Verificado contra producción: los 28 perfiles tienen email único, 25 de 28 no tienen DNI cargado.
- **Mapeo etiqueta↔enum en un módulo único del servidor**, que el import va a reusar. No lo repliques.
- **Segunda hoja de referencia** con las combinaciones válidas de estado y motivo.
- Orden de filas: por nombre de empleado y después por fecha. Que se pueda leer de corrido.

---

## Paso 2 — Desplegables y bloqueo

- Validación de datos en las celdas de `estado` y `motivo`.
- `email`, `nombre` y `fecha` bloqueadas.
- **Verificá y reportá si la validación sobrevive al abrir el archivo en Google Sheets.** No lo des por sentado en ninguna dirección: probalo y decí qué pasó.
- Dejá constancia en el código de que el desplegable es comodidad, **no un control**: la validación real corre server-side en el import.

---

## Paso 3 — Interfaz

- Acción de exportar en el módulo Calendario, **solo admin**, con selector de rango de fechas.
- Guard de rol **server-side**, no solo oculto en la UI. El guard corta por `redirect()`, no por `{ ok }` (§2.5, excepción FB-F5-AUD-05).
- `createServerClient()`. Nunca `createAdminClient()`.
- Leé el `{ error }` de PostgREST como valor; un `try/catch` no lo captura (§2.5).
- Si la generación falla, mensaje es-AR desde `/lib/copy` por el contrato return-based. Nada de pantalla rota.
- Nombre del archivo con el rango incluido, para que no se pisen entre descargas.
- Copy 100 % es-AR desde `/lib/copy`.

---

## Paso 4 — Tests

- **Límite de rol para los 3 roles:** admin exporta; supervisor y empleado reciben el corte server-side.
- El archivo tiene una fila por cada combinación empleado activo × día del rango, incluidos los vacíos.
- Los empleados **inactivos no aparecen**.
- Las celdas de estado y motivo llevan validación; email, nombre y fecha están bloqueadas.
- El mapeo etiqueta↔enum cubre todos los valores de ambos enums. Que el test **falle** si se agrega un valor al enum y no se mapea.
- e2e: el admin exporta y el archivo se descarga. **No rompas la suite existente** (31 e2e hoy, tercer job de CI).

---

## Fuera de alcance

- Todo el import (`FB-PI-05`).
- Export de cualquier otra entidad.
- Selector individual de empleados: en esta versión son todos los activos.
- CSV.
- Las dos purgas pendientes (Santiago y calendario de prueba) — van en sus propios prompts.
- Los desfasajes de documentación de la constitución (Log `rec2CQcbv5jKODcAF`) — PR docs-only aparte.

---

## Definición de Done

Skill `dod-checklist`, más:

- [ ] `docs/audits/FB-PI-04-INSPECT.md` y `docs/prd-calendario-export-import.md` commiteados.
- [ ] Export funcionando, admin-only, con rango de fechas.
- [ ] Filas en blanco para los días sin asignación.
- [ ] Desplegables y celdas bloqueadas; comportamiento en Google Sheets verificado y reportado.
- [ ] Mapeo etiqueta↔enum en módulo único reutilizable por el import.
- [ ] Test de rol para los 3 roles. CI verde en los tres jobs.
- [ ] Copy es-AR. Sin secretos. Sin migración.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-04.md`.

**El merge lo autoriza Luciano, sin excepción.** Antes de pedirlo, entregá el estado real del repo: branch, PR con CI por job, commits fuera de main.
