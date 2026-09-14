# FB-PI-AUD-01 — Auditoría del diff de FB-PI-01

- **ID:** FB-PI-AUD-01
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Codex
- **Guardar en:** `docs/prompts/FB-PI-AUD-01.md` · informe en `docs/audits/FB-PI-AUD-01.md`
- **Auditás contra:** `docs/constitucion.md` **v0.8** + el prompt `FB-PI-01` + `docs/audits/FB-PI-01-INSPECT.md`

---

## Encuadre

Pieza de **interfaz/feature, sin migración**. Aplica el nivel de rigor correspondiente (constitución §1.1): auditoría sí, triage del Developer después, sin re-auditoría salvo que haya algo bloqueante.

**No escribís código de features.** Solo hallazgos.

Cambio auditado: la campanita de la topbar pasa a mostrar un contador de aprobaciones pendientes para el admin y a navegar a la bandeja Aprobaciones. Solo lectura, sin esquema nuevo.

---

## Foco de auditoría

1. **Coincidencia del número con la bandeja.** ¿El contador y la lista de Aprobaciones se calculan desde la **misma** fuente? Si hay dos queries separadas, es hallazgo: se van a desincronizar. Verificá especialmente que el contador replique cualquier **filtro de negocio superpuesto a la RLS** que tenga la cola (constitución §5 documenta filtrado por motivo + estado en ausencias).
2. **Alcance del conteo.** Pasajes + ausencias + documentos en `estado = 'pendiente'`. **No** debe haber referencia a onboarding/precarga: ese módulo se eliminó en `FB-ADJ-03` (§4/§8).
3. **Límite de rol.** El contador es admin-only. Verificá que para supervisor y empleado no se renderice **y** que no se dispare la consulta. Confirmá que la UI no sea el único control: la RLS sigue siendo la autoridad (§12.1).
4. **Cliente de Supabase.** Debe usar `createServerClient()`. El uso de `createAdminClient()` para esta lectura es **hallazgo bloqueante**: saltea RLS (§6.1).
5. **Errores de PostgREST leídos como valor.** Un `.select()` fallido devuelve `{ error }`, no tira; un `try/catch` alrededor no lo cubre (§2.5). Si el conteo ignora el `error`, es hallazgo.
6. **Degradación ante fallo.** Un error de lectura no puede tumbar el render del layout ni de la topbar.
7. **Clases de Tailwind literales.** Ninguna clase del badge compuesta en runtime. Es la causa exacta del bug del franco (PR #49): el JIT no emite lo que no ve escrito entero. Hallazgo si aparece composición dinámica.
8. **Revalidación del layout.** Después de aprobar o rechazar, ¿el número baja? El badge vive en el layout, no en la página; un `revalidatePath` que solo cubra la página deja el contador viejo. Verificá que el caso esté resuelto y no solo asumido.
9. **Cero pendientes.** Sin badge. Ni globito vacío, ni "0".
10. **Copy es-AR** desde `/lib/copy`, incluido el `aria-label`. Sin strings hardcodeados (§10).
11. **Tests.** ¿Existe el test de límite de rol para los 3 roles? ¿El test afirma el **efecto visible** (badge presente/ausente, número correcto) y no un string de clase CSS? ¿El e2e existente sigue verde?
12. **Sin secretos**, sin migración, sin cambios colaterales fuera de alcance. En particular, el bug de `audit_log` tragado en `aprobaciones/actions.ts` (Log `recgttytHv9848xI8`) **no** debe estar arreglado en este diff: es otra entrada del Log. Si aparece, es hallazgo de alcance.

---

## Formato del informe

Entregá el informe **dentro de un bloque de código**, para que el Markdown no se aplane en el traslado y el verbatim sea fiel (constitución §1.1).

Estructura por hallazgo:
```
HALLAZGO N — <título corto>
Severidad: Bloqueante | Mayor | Menor | Observación
Archivo:Línea
Qué: <qué está mal>
Por qué: <qué regla de la constitución o del prompt incumple>
Sugerencia: <qué debería pasar — sin escribir el código>
```

Si no hay hallazgos, decilo explícitamente. No inventes hallazgos para llenar el informe.
