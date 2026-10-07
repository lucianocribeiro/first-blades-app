# FB-PI-11-C — Corrección de los 5 hallazgos de `FB-PI-AUD-11`

- **ID:** FB-PI-11-C
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11-C.md`
- **Continúa:** `FB-PI-11-B` (migración 0022, PR #56 en draft)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** 0022, **todavía sin aplicar**.

---

## Triage

Codex devolvió **5 hallazgos: 1 bloqueante, 3 mayores y 1 menor.**

**Los cinco se corrigen antes del `db push`.** Ninguno se difiere al Log. La migración no está aplicada, así que todos se arreglan editando archivos; después del push, cualquiera de ellos obligaría a una segunda migración sobre producción.

**Después de corregir va re-auditoría** (§1.1: migraciones llevan ceremonia completa, con re-auditoría si hay hallazgos). No es el nivel de features.

---

## Hallazgo 1 (BLOQUEANTE) — La guarda permite `is_admin()` NULL

`supabase/migrations/0022_import_calendario.sql:104-110`

La guarda es `auth.uid() IS NULL OR NOT public.is_admin()`. **Si `is_admin()` devuelve NULL, `NOT NULL` es NULL, que no es TRUE, así que el aborto nunca se dispara.** Una sesión autenticada sin perfil podía importar y escribir auditoría sin ser admin.

Es exactamente el caso que §6.1 y §12.6 nombran — "NULL tratado como no-admin" — y se escapó igual.

- Evaluá `is_admin()` explícitamente **como TRUE**, no por negación. La condición de continuar tiene que ser afirmativa.
- **Agregá un test con JWT `authenticated` sin perfil** que verifique que la función aborta.
- **Revisá si el mismo patrón aparece en otras guardas** de esta migración o en otras funciones que hayas tocado. Si el error está en un lugar, puede estar en más.

---

## Hallazgo 2 (Mayor) — La RPC no revalida la ventana de fechas

`supabase/migrations/0022_import_calendario.sql:144-169`

Valida el tope de 366 días pero no el rango `2020-01-01` a hoy + 2 años, que la app sí valida.

**La RPC es el control autoritativo de escritura**, igual que la RLS lo es para los permisos. Una validación que vive solo en la app se saltea invocando la RPC directamente.

- Validá **los dos** límites dentro de la RPC.
- Tests de integración para cada uno.

---

## Hallazgo 3 (Mayor) — La previsualización trunca en 500 sin avisar

`app/(app)/calendario/import-actions.ts:51-53,158,184-185`

`borrados` y `pisados` se cortan en 500 elementos, con los conteos completos pero **sin informar el truncado**.

**El problema no es el tope, es el silencio.** Es la misma familia de error que el truncamiento de PostgREST que cerramos en `FB-PI-05`: el admin ve una lista que parece completa, confirma, y escribe sobre días que nunca vio.

- **Preferido:** mostrar la lista completa. Los datos ya están en memoria.
- **Aceptable si hay una razón de rendimiento:** mantener el tope **pero decirlo de forma visible y en es-AR** ("mostrando 500 de N"), con alguna manera de ver el resto. Si tomás este camino, justificá por qué.
- **Inaceptable:** que el admin no pueda distinguir una lista completa de una truncada.

---

## Hallazgo 4 (Menor) — El test del 40001 es textual

`tests/integration/migration.test.ts:1371-1379`

Solo prohíbe la cadena `ERRCODE = '40`; no detectaría una reintroducción con otra sintaxis válida.

- Hacé la comprobación **independiente de la sintaxis**.
- **Ejercitá la ruta de aborto** y verificá el código que devuelve, en vez de inspeccionar el texto del SQL.

Vale la pena hacerlo bien: el 40001 habría dejado bucles de reintento con CPU alta en producción, sin mensaje al usuario.

---

## Hallazgo 5 (Mayor) — El alta no usa la normalización del índice

`app/(app)/gestion-usuarios/actions.ts:38-55,78-88`

El índice usa `lower(btrim(email))`, pero `createUser()` busca con `ilike` sin recortar el valor almacenado. Una colisión puede terminar mostrando un error crudo de base en vez del copy es-AR.

- Usá **exactamente la clave normalizada del índice**, el mismo `lower(btrim(...))`.
- Mapeá las colisiones de unicidad a `emailDuplicado`, con el mensaje en es-AR.
- **Verificá que el import use también esa misma normalización** al matchear emails. Si el índice normaliza de una forma y el import de otra, van a rechazarse emails válidos como inexistentes.

---

## Después de corregir ⛔

1. CI verde en los tres jobs.
2. **Re-auditoría con Codex.** No pidas el `db push` hasta que vuelva limpia.
3. Versioná el informe de `FB-PI-AUD-11` **verbatim**, en bloque de código, en `docs/audits/FB-PI-AUD-11.md`, con la nota del triage debajo. El de la re-auditoría va igual cuando llegue.

**El `db push` lo corre Luciano, por el runbook gateado** (§2.3). No lo pidas antes de la re-auditoría limpia.

---

## Fuera de alcance

- Los dos riesgos registrados sin acción por decisión de Luciano (cancelación de ausencia que borra días importados, edición manual sin auditoría).
- Corregir las funciones 0013–0019 para que usen `log_audit()`.
- Configuración de Gmail.

---

## Definición de Done

- [ ] Hallazgo 1 corregido con evaluación afirmativa de `is_admin()`, test de JWT sin perfil, y el patrón revisado en el resto de las guardas.
- [ ] Hallazgo 2 corregido con los dos límites validados en la RPC, con tests.
- [ ] Hallazgo 3 corregido: sin truncado silencioso.
- [ ] Hallazgo 4 corregido: comprobación independiente de la sintaxis, ejercitando la ruta de aborto.
- [ ] Hallazgo 5 corregido, con la normalización alineada entre índice, alta e import.
- [ ] CI verde en los tres jobs.
- [ ] Informe de `FB-PI-AUD-11` versionado verbatim con la nota de triage.
- [ ] **Re-auditoría limpia antes de pedir el push.**
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11-C.md`.
