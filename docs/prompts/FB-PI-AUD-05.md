# FB-PI-AUD-05 — Auditoría del diff de FB-PI-05 (PR #51)

- **ID:** FB-PI-AUD-05
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Codex
- **Guardar en:** `docs/prompts/FB-PI-AUD-05.md` · informe en `docs/audits/FB-PI-AUD-05.md`
- **Auditás contra:** `docs/constitucion.md` **v0.8** + `FB-PI-05` + `FB-PI-05-B` + `docs/audits/FB-PI-05-DIAG.md`

---

## Encuadre

Pieza de **feature/infraestructura de lectura, sin migración**. Nivel de rigor de features (§1.1): auditás, el Developer triagea, sin re-auditoría salvo bloqueante. **No escribís código de features.**

Qué se arregló: PostgREST corta en 1000 filas **sin devolver error**, así que varias lecturas de la app podían devolver datos incompletos sin que nada lo señalara. El fix introduce `fetchAllRows` en `lib/supabase/fetch-all.ts` y lo aplica a 9 lecturas.

**Lo que está en juego acá no es el rendimiento, es la corrección de los datos.** Un helper que devuelve resultados parciales en algún borde es peor que no tener helper, porque instala confianza donde no la hay. Auditá con ese criterio.

---

## Foco de auditoría

### Sobre el helper `fetchAllRows`

1. **Orden determinístico de paginación.** Paginar con `.range()` sobre una consulta **sin un `order` estable y único** puede **saltear o duplicar filas**: Postgres no garantiza orden entre páginas, y cualquier inserción concurrente desplaza el offset. Verificá que cada llamada tenga un orden total definido (o que el helper lo imponga). **Si alguna lectura paginada no tiene orden estable, es hallazgo bloqueante** — devuelve datos incorrectos justamente en el caso que el fix viene a arreglar.
2. **Nunca devuelve parciales.** Ante error de cualquier página, ¿descarta lo acumulado y devuelve error, o puede filtrarse un resultado incompleto por algún camino?
3. **Error de PostgREST leído como valor** en cada página. Un `.select()` fallido devuelve `{ error }`, no tira; un `try/catch` no lo cubre (§2.5).
4. **Condición de corte.** Corta al recibir una página vacía: verificá que también corte bien si una página vuelve con menos filas que el tamaño pedido, y que no entre en bucle ante una página que vuelve siempre igual.
5. **Tope de seguridad (50.000).** ¿Se alcanza devolviendo **error**, o devuelve lo que juntó? Si devuelve lo juntado, es el mismo bug que estamos arreglando, con otro número.
6. **El helper no amplía privilegios.** Que no cambie el cliente de Supabase de la llamada original: lo que corría con `createServerClient()` sujeto a RLS sigue igual. Si alguna conversión pasó una lectura a `createAdminClient()`, es hallazgo bloqueante.

### Sobre los 9 call sites

7. **Cobertura completa.** Los 9 casos del diagnóstico (roster, alertas de franco, las dos lecturas de los crons, idempotencia de `notification_log`, documentos con vencimiento, Equipo, Aprobadas) usan el helper. Señalá cualquiera que haya quedado afuera.
8. **Ninguna lectura sin paginar nueva** introducida por el diff.
9. **Filtros preservados.** Cada conversión mantiene exactamente los mismos filtros, `select` y scope de negocio que antes. Una conversión que ensanche el conjunto (ej. deje de filtrar por activos) es hallazgo.
10. **Crons.** Confirmá que las lecturas de idempotencia de `notification_log` quedaron correctas: si truncan, se mandan **mails duplicados a los empleados**. Es la consecuencia visible para el cliente.
11. **Aprobadas: solo cambió la lectura, no la UI.** Si el diff toca la UI de esa pantalla, es hallazgo de alcance — está diferido a propósito (Log `recjXWDGc8OdlWGWj`).

### Sobre los tests

12. **¿Se ponen rojos sin el fix?** El valor del test está en que falle si alguien saca la paginación. Evaluá si el cliente de prueba imita a PostgREST con fidelidad: corta en 1000 filas **sin error**, en silencio.
13. **¿Cubren el borde?** Exactamente 1000 filas, 1001, y una página intermedia que falla.
14. No se rompe la suite existente (31 e2e, tercer job de CI).

### Transversal

15. Copy es-AR desde `/lib/copy` (§10). Sin secretos. Sin migración ni cambio de esquema. Contrato return-based donde aplique (§2.5).

---

## Formato del informe

Entregá el informe **dentro de un bloque de código**, para que el Markdown no se aplane en el traslado y el verbatim sea fiel (§1.1).
```yaml
HALLAZGO N — <título corto>
Severidad: Bloqueante | Mayor | Menor | Observación
Archivo:Línea
Qué: <qué está mal>
Por qué: <qué regla de la constitución o del prompt incumple>
Sugerencia: <qué debería pasar — sin escribir el código>
```

Si no hay hallazgos, decilo explícitamente. No inventes hallazgos para llenar el informe.
