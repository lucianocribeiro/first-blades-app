# FB-PI-AUD-11-B — Re-auditoría de la migración 0022 (PR #56)

- **ID:** FB-PI-AUD-11-B
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Codex
- **Guardar en:** `docs/prompts/FB-PI-AUD-11-B.md` · informe en `docs/audits/FB-PI-AUD-11-B.md`
- **Auditás contra:** `docs/constitucion.md` **v0.8** + `docs/audits/FB-PI-AUD-11.md` (tu informe anterior) + `FB-PI-11-C` + `docs/prd-calendario-export-import.md`
- **Cabeza del branch:** `f6b5734`

---

## Encuadre

**Re-auditoría de migración** (§1.1): la ceremonia completa exige volver a auditar después de corregir hallazgos. La migración 0022 **sigue sin aplicarse**; el `db push` espera a que esto vuelva limpio.

En tu auditoría anterior devolviste 5 hallazgos: 1 bloqueante, 3 mayores, 1 menor. **Los cinco se corrigieron en el mismo PR**, ninguno se difirió.

Esta pasada es **focalizada**: verificar que cada corrección hace lo que dice, y que ninguna introdujo un problema nuevo. No hace falta repetir lo que ya confirmaste salvo que el diff lo haya tocado.

---

## Verificación de las cinco correcciones

### Hallazgo 1 (era bloqueante) — Guarda con `is_admin()` NULL

1. ¿La condición evalúa `is_admin()` **afirmativamente como TRUE**, y no por negación? Una guarda que siga dependiendo de `NOT` sobre algo que puede ser NULL **sigue siendo bloqueante**.
2. ¿El test con JWT `authenticated` **sin perfil** existe y **ejercita realmente** la función, o solo inspecciona el texto del SQL? Un test que no invoca no prueba nada.
3. **¿Queda alguna otra guarda en 0022 escrita por negación?** Se pidió revisar el patrón completo, no solo la línea señalada.

### Hallazgo 2 (era mayor) — Ventana de fechas en la RPC

4. ¿La RPC valida **los dos** límites: el tope de 366 días **y** el rango `2020-01-01` a hoy + 2 años?
5. ¿Hay tests de integración para cada límite, que **fallen** si se saca la validación?
6. ¿La validación está en la RPC y no solo en la app? La RPC es el control autoritativo: lo que vive solo en la app se saltea invocándola directo por REST.

### Hallazgo 3 (era mayor) — Truncado silencioso de la previsualización

7. ¿Se eliminó el truncado silencioso? El criterio es: **el admin tiene que poder distinguir una lista completa de una truncada.**
8. Si se mantuvo un tope por rendimiento, ¿está informado de forma **visible y en es-AR**, con manera de ver el resto? Si el aviso vive solo en el código o en un comentario, no cuenta.
9. ¿Los conteos siguen siendo completos y coherentes con lo que la función va a escribir?

### Hallazgo 4 (era menor) — Test del 40001

10. ¿La comprobación es **independiente de la sintaxis**, o sigue buscando una cadena de texto?
11. ¿**Ejercita la ruta de aborto** y verifica el código devuelto, en vez de inspeccionar el SQL?
12. ¿Fallaría ante la reintroducción de cualquier código de clase 40, no solo del 40001 escrito de una forma puntual?

### Hallazgo 5 (era mayor) — Normalización del email

13. ¿El alta usa **exactamente** `lower(btrim(email))`, la misma clave del índice?
14. ¿Las colisiones de unicidad se mapean a `emailDuplicado` con copy es-AR, sin que pueda filtrarse un error crudo de base por ningún camino?
15. **¿El import usa esa misma normalización** al matchear emails? Si el índice normaliza de una forma y el import de otra, se van a rechazar emails válidos como inexistentes, con un síntoma confuso.

---

## Regresiones

16. **Atomicidad:** ¿alguna de las cinco correcciones abrió un camino por el que quede una importación a medias?
17. **Test de ida y vuelta:** exportar y reimportar sin cambios sigue dejando la base idéntica.
18. **Filas sin cambios no se tocan**, ni siquiera la fecha de modificación.
19. El resto del molde §6.1 sigue intacto: `search_path` fijo, `REVOKE` de `anon` y `PUBLIC`, owner correcto, `PERFORM log_audit(...)`.
20. **Drift detector** actualizado y consistente con el estado final de la migración.
21. Copy es-AR, sin secretos, delta-only.

---

## Fuera de tu alcance

- **Las nueve funciones de producción con la misma falla de guarda.** Decisión tomada: van en **migración separada**, después de cerrar el import. Están en el Log como `recfamWK93drsaCiQ`. **No las marques como hallazgo de este PR.**
- Que cancelar una ausencia aprobada borre días importados de ese rango, y que la edición manual del calendario no escriba en `audit_log`: ambos registrados y sin acción por decisión de Luciano.
- Corregir las funciones 0013–0019 para que usen `log_audit()`.
- Configuración de Gmail.

---

## Formato del informe

Entregá el informe **dentro de un bloque de código**, para que el Markdown no se aplane en el traslado (§1.1).

```
HALLAZGO N — <título corto>
Severidad: Bloqueante | Mayor | Menor | Observación
Archivo:Línea
Qué: <qué está mal>
Por qué: <qué regla de la constitución, del PRD o del prompt incumple>
Sugerencia: <qué debería pasar — sin escribir el código>
```

Si no hay hallazgos, decilo explícitamente. **No inventes hallazgos para llenar el informe, y no re-marques cosas que ya diste por correctas en la pasada anterior si el diff no las tocó.**

Cualquier hallazgo nuevo dispara otra vuelta: la migración no se aplica hasta que esto vuelva limpio.
