# FB-PI-AUD-11 — Auditoría de la migración 0022 y del import de calendario (PR …)

- **ID:** FB-PI-AUD-11
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Codex
- **Guardar en:** `docs/prompts/FB-PI-AUD-11.md` · informe en `docs/audits/FB-PI-AUD-11.md`
- **Auditás contra:** `docs/constitucion.md` **v0.8** + `docs/prd-calendario-export-import.md` + `FB-PI-11` + `FB-PI-11-B` + `docs/audits/FB-PI-11-INSPECT.md` + `docs/audits/FB-PI-11-SCHEMA-PREPUSH.md`

---

## Encuadre — ceremonia completa

**Esto lleva migración, así que aplica el nivel de rigor máximo** (§1.1): auditoría, y **re-auditoría si hay hallazgos**. No es el nivel de features donde alcanza con el triage del Developer.

**La migración todavía NO está aplicada.** Estás auditando antes del `db push`, que es el momento en que corregir todavía es barato: un hallazgo ahora se arregla editando un archivo; el mismo hallazgo después del push obliga a una segunda migración sobre producción.

Qué se construyó: la migración 0022 (índice único de email normalizado + función `SECURITY DEFINER` de importación masiva) y el flujo de import de calendario desde Excel, con previsualización obligatoria.

**No escribís código de features.** Solo hallazgos.

---

## Foco de auditoría

### La función `SECURITY DEFINER` (§6.1 y §12.6) — lo más importante

1. **Guardas internas como control principal.** Admin verificado contra `auth.uid()`, **NULL tratado como no-admin**, **nunca desde un parámetro**. Una guarda que confíe en un argumento es **hallazgo bloqueante**.
2. **`search_path` fijo explícito.**
3. **`EXECUTE` solo a `authenticated`, con `REVOKE` explícito de `anon` y de `PUBLIC`.** Supabase re-otorga a `anon` por default: si falta el `REVOKE`, es bloqueante.
4. **Owner** = rol de administración, no un rol de app.
5. **Auditoría por `PERFORM public.log_audit(...)`**, nunca por `INSERT` directo. Las funciones 0013–0019 usan `INSERT` directo: es inconsistencia heredada y **no debe copiarse** acá.
6. **Atomicidad real.** ¿Un fallo en cualquier punto revierte todo? ¿Hay algún camino por el que quede una importación a medias?

### El código de error FBC01

7. En la primera corrida de CI la función abortaba con **40001**, que PostgREST 14 interpreta como error transitorio y **reintenta sin fin**: en producción habría quedado un bucle con CPU alta en cada confirmación desactualizada, sin mensaje al usuario. Se cambió por **FBC01**.
   - Verificá que **no quede ningún 40001** ni ningún otro código de la clase 40 en ningún camino de la función.
   - Verificá que FBC01 **no colisione** con códigos de error estándar de Postgres.
   - Verificá que el test que detecta la vuelta del 40001 **falle** si alguien lo reintroduce.

### El índice único de email

8. **Normalización coherente.** El índice normaliza a minúsculas y sin espacios. ¿El matcheo del import usa **exactamente el mismo criterio**? Si el índice normaliza de una forma y la búsqueda de otra, se desincronizan y el import puede no encontrar un perfil que sí existe. **Hallazgo si difieren.**
9. **Cambio de comportamiento del alta de usuarios.** A partir de este índice, dos perfiles que difieran solo en mayúsculas o espacios son imposibles. ¿El alta de Gestión de Usuarios devuelve un error legible en es-AR y no un error crudo de base? ¿Está documentado?
10. **Drift detector** (`migration.test.ts`) actualizado intencionalmente, con el índice y la función nueva en el inventario; para la función, `prosecdef`, `proconfig` y owner-consistency.
11. **Delta-only:** la migración escribe solo el delta y no asume que la branch matchea producción.

### Validación e integridad de datos

12. **Toda la validación es server-side.** El desplegable del Excel no es un control: se puede pegar texto encima. Si algo confía en que el archivo viene con valores válidos, es hallazgo.
13. **Las seis decisiones, implementadas como se aprobaron:** concurrencia con aborto si los conteos difieren y filas sin cambios intactas; `es_estimado` **true para días futuros y false para pasados**; admins e inactivos como error; email duplicado como error además del índice; `import_id` como `record_id` con acción `calendario_importado`; definición de "pisar" con la condición de la 0017; y las cinco reglas de rango y filas, incluida la normalización de fechas que Excel convirtió a su formato interno.
14. **Motivo con estado distinto de "Fuera del trabajo":** la base no lo impide, lo valida la función. Verificá que efectivamente lo valide.
15. **Celda de estado vacía = borrar el día.** ¿Está implementado así y **dicho con todas las letras en la previsualización**, no solo en el código?
16. **El import no toca `ausencia_requests` ni `pasaje_requests`**, ni siquiera al pisar un día que una de ellas generó.
17. **`audit_log` en modelo híbrido:** una entrada de resumen por importación, más entrada por-día **solo** de los días pisados. Ni más ni menos.

### Previsualización y permisos

18. **Imposible de saltear.** ¿Hay algún camino que escriba sin pasar por la confirmación? Con errores de validación, ¿la confirmación está bloqueada **del lado del servidor** y no solo deshabilitada en la UI?
19. Los cinco bloques presentes: crear/modificar/sin cambios, días pisados listados uno por uno, errores con número de fila, impacto en el saldo de días de trámite, y cuántos días se borran.
20. **Admin-only server-side.** El guard corta por `redirect()`, no por `{ ok }` (§2.5, excepción FB-F5-AUD-05).
21. **`createServerClient()`, nunca `createAdminClient()`**: `service_role` no tiene `sub` en el JWT y la guarda `auth.uid()` abortaría siempre.
22. **`{ error }` de PostgREST leído como valor** (§2.5). Contrato return-based. Copy es-AR desde `/lib/copy`.
23. Cualquier lectura que pueda superar 1000 filas usa `fetchAllRows`.

### Tests

24. **Ida y vuelta:** exportar y reimportar sin cambios deja la base **idéntica**. Es el test de mayor valor del PR: evaluá si realmente lo prueba o si hay huecos.
25. ¿Los tests de atomicidad verifican que **nada** quede escrito ante un fallo, no solo que la operación devuelva error?
26. Límite de rol para los 3 roles. Volumen realista (2300 filas). e2e existentes sin romper.

---

## Fuera de tu alcance

- Que cancelar una ausencia aprobada borre días importados de ese rango, y que la edición manual del calendario no escriba en `audit_log`. **Ambos registrados y sin acción por decisión de Luciano.** No los marques como hallazgo.
- Corregir las funciones 0013–0019 para que usen `log_audit()`.
- Configuración de Gmail.

---

## Formato del informe

Entregá el informe **dentro de un bloque de código**, para que el Markdown no se aplane en el traslado y el verbatim sea fiel (§1.1).

```
HALLAZGO N — <título corto>
Severidad: Bloqueante | Mayor | Menor | Observación
Archivo:Línea
Qué: <qué está mal>
Por qué: <qué regla de la constitución, del PRD o del prompt incumple>
Sugerencia: <qué debería pasar — sin escribir el código>
```

Si no hay hallazgos, decilo explícitamente. No inventes hallazgos para llenar el informe.

**Recordá: al ser una migración, cualquier hallazgo dispara re-auditoría después de corregirlo.**
