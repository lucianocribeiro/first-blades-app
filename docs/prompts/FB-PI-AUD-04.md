# FB-PI-AUD-04 — Auditoría del diff de FB-PI-04 (PR #52)

- **ID:** FB-PI-AUD-04
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Codex
- **Guardar en:** `docs/prompts/FB-PI-AUD-04.md` · informe en `docs/audits/FB-PI-AUD-04.md`
- **Auditás contra:** `docs/constitucion.md` v0.8 + `docs/prd-calendario-export-import.md` + `FB-PI-04` + `FB-PI-04-B` + `docs/audits/FB-PI-04-INSPECT.md`
- **Cabeza del branch:** `0df5f62`

Pieza de feature, solo lectura, sin migración. Nivel de rigor de features (§1.1): auditás, el Developer triagea, sin re-auditoría salvo bloqueante. No escribís código de features.

Qué se construyó: el admin exporta el calendario a un `.xlsx` con una fila por empleado y por día del rango, incluidos los días sin asignación, con desplegables de validación en las celdas editables. Es el primero de dos PRs: el import va aparte y sí lleva migración.

Este export es la fuente del formato que después va a consumir el import. Un error de formato acá se propaga al import y al archivo que Luciano va a completar a mano con tres meses de historial. Auditá con ese peso.

## Foco de auditoría

1. **Cobertura del rango.** Una fila por cada combinación de empleado en alcance × día del rango, incluidos los días sin asignación, que salen con estado vacío. Si hubiera días faltantes, el admin no tendría dónde cargar el historial, que es justamente el caso de uso.
2. **Alcance de empleados:** empleados y supervisores activos, sin admins. Decisión explícita de Luciano, documentada en el PRD. Verificá que el código haga exactamente eso y que no haya nombres de función o comentarios que digan “todos los activos” cuando no es así. Los inactivos no deben aparecer.
3. **Clave email, no DNI.** La constitución §5 designa `dni` como clave de import de historial; esa designación no es aplicable (25 de 28 perfiles no tienen DNI). Confirmá que el export use email y que no haya rastro de lógica basada en DNI.
4. **Lectura paginada.** El export usa `fetchAllRows`, el helper compartido mergeado en FB-PI-05, y no una implementación propia. Si quedó un loop de paginación paralelo, es hallazgo: dos implementaciones de lo mismo es cómo una de las dos se queda vieja.
5. **Etiqueta única para `periodo_fuera_trabajo`:** “Fuera del trabajo”. Se unificó en FB-PI-04-B. Verificá que no quede ningún literal con “Período fuera del trabajo” en el mapeo, el desplegable, la hoja de Referencia o la app.
6. **Una sola fuente.** La etiqueta sale de `/lib/copy` y el mapeo la consume. Dos literales para el mismo estado es hallazgo, aunque hoy coincidan: es exactamente la divergencia que este ajuste vino a cerrar.
7. **Mapeo etiqueta↔enum completo y en un módulo único**, con las funciones inversas que va a reusar el import. ¿Cubre todos los valores de `estado_dia` y `motivo_ausencia`? ¿El test se pone rojo si se agrega un valor al enum sin mapear?
8. **Etiquetas de los otros tres estados y de los motivos:** ¿coinciden con lo que muestra la app? Señalá cualquier divergencia.
9. **Desplegables y bloqueo.** Validación de datos en estado y motivo; email, nombre y fecha bloqueadas.
10. **El desplegable no se usa como control.** La validación real tiene que ser server-side en el import; verificá que el código no instale la expectativa contraria. Nada acá debe asumir que el archivo vuelve con valores válidos.
11. **Hoja de Referencia** con las combinaciones válidas de estado y motivo.
12. **`exceljs` corre solo en el servidor.** Que no se filtre al bundle del cliente.
13. **Admin-only, server-side.** `requireAdmin()` corta por `redirect()`, no por `{ ok }` (§2.5, excepción FB-F5-AUD-05). Ocultarlo en la UI no alcanza: la RLS y el guard son el control.
14. **`createServerClient()`, nunca `createAdminClient()`.** Es una lectura de feature sujeta a RLS.
15. **Error de PostgREST leído como valor** (§2.5). Un `try/catch` no captura el `{ error }` de un `.select()` fallido.
16. **Contrato return-based** en la Server Action, con copy es-AR desde `/lib/copy` ante fallo de generación.
17. Sin secretos, sin migración, sin cambios de esquema.
18. **Límite de rol para los 3 roles.** Admin exporta; supervisor y empleado reciben el corte server-side.
19. **Tests:** ¿verifican el contenido real del archivo (filas, celdas, validaciones) o solo que la acción no falle?
20. **Nada del import en este diff.** Ni ruta, ni parser, ni previsualización, ni migración. La excepción permitida es el mapeo compartido. Si aparece algo más del import, es hallazgo de alcance.
21. Los 31 e2e existentes siguen pasando; los 4 nuevos cubren el export.

La verificación de los desplegables en Google Sheets es prueba manual de Luciano, no la audites ni la marques como hallazgo.

El import, las purgas pendientes y los desfasajes de documentación de la constitución (`rec2CQcbv5jKODcAF`) quedan fuera de alcance.

## Formato del informe

Entregá el informe dentro de un bloque de código, para que el Markdown no se aplane en el traslado y el verbatim sea fiel (§1.1).

```yaml
HALLAZGO N — <título corto>
Severidad: Bloqueante | Mayor | Menor | Observación
Archivo:Línea
Qué: <qué está mal>
Por qué: <qué regla de la constitución, del PRD o del prompt incumple>
Sugerencia: <qué debería pasar — sin escribir el código>
```

Si no hay hallazgos, decilo explícitamente. No inventes hallazgos para llenar el informe.
