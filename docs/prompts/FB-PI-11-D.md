# FB-PI-11-D — Informe verbatim de `FB-PI-AUD-11` y decisión sobre las 9 funciones

- **ID:** FB-PI-11-D
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11-D.md`
- **Continúa:** `FB-PI-11-C` (5 hallazgos corregidos, CI verde en `a2a358c`, PR #56 en draft)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** 0022, todavía sin aplicar.

---

## 1. Informe de `FB-PI-AUD-11`, verbatim

Guardalo **tal cual**, dentro de un bloque de código, en `docs/audits/FB-PI-AUD-11.md`. Sin editar, sin resumir, sin reformatear (§1.1).

```
HALLAZGO 1 — La guarda de la RPC permite un `is_admin()` NULL para sesiones autenticadas sin perfil
Severidad: Bloqueante
Archivo:supabase/migrations/0022_import_calendario.sql:104-110
Qué: `auth.uid() IS NULL OR NOT public.is_admin()` permite pasar cuando `is_admin()` devuelve NULL para un JWT autenticado sin perfil.
Por qué: Incumple §6.1 y §12.6: NULL debe tratarse como no-admin. En una función SECURITY DEFINER permite importar y auditar sin ser administrador.
Sugerencia: Evaluar explícitamente `is_admin()` como TRUE y agregar un test con JWT authenticated sin perfil.

HALLAZGO 2 — La RPC no vuelve a validar la ventana razonable de fechas
Severidad: Mayor
Archivo:supabase/migrations/0022_import_calendario.sql:144-169
Qué: Solo valida el máximo de 366 días; no aplica el límite `2020-01-01` a hoy + 2 años que sí valida la app.
Por qué: La RPC es el control autoritativo de escritura y debe repetir la validación server-side.
Sugerencia: Validar ambos límites dentro de la RPC y agregar tests de integración.

HALLAZGO 3 — La previsualización deja días afectados fuera del listado obligatorio
Severidad: Mayor
Archivo:app/(app)/calendario/import-actions.ts:51-53,158,184-185
Qué: `borrados` y `pisados` se limitan a 500 elementos, aunque los conteos son completos y no se informa el truncado.
Por qué: El PRD exige listar uno por uno los días pisados y permitir revisar todos los impactos antes de confirmar.
Sugerencia: Mostrar la lista completa o incorporar paginación/expansión obligatoria.

HALLAZGO 4 — El test que protege contra 40001 solo detecta una forma textual
Severidad: Menor
Archivo:tests/integration/migration.test.ts:1371-1379
Qué: Solo prohíbe `ERRCODE = '40`; no detectaría una reintroducción equivalente con otra sintaxis válida.
Por qué: El test debe fallar ante cualquier reintroducción de 40001 o de otro código de clase 40.
Sugerencia: Hacer la comprobación independiente de la sintaxis y ejercitar la ruta de aborto.

HALLAZGO 5 — El chequeo de duplicado del alta no usa la misma normalización del índice
Severidad: Mayor
Archivo:app/(app)/gestion-usuarios/actions.ts:38-55,78-88
Qué: El índice usa `lower(btrim(email))`, pero `createUser()` busca con `ilike` sin recortar el valor almacenado. Una colisión puede terminar mostrando un error crudo de base.
Por qué: Incumple el comportamiento aprobado: la alta debe devolver copy es-AR ante una colisión normalizada.
Sugerencia: Usar exactamente la clave normalizada del índice y mapear colisiones de unicidad a `emailDuplicado`.
```

Debajo del bloque, **fuera** del código y marcado como nota del Developer, dejá el triage: 5 hallazgos (1 bloqueante, 3 mayores, 1 menor), **los cinco corregidos en el mismo PR antes del `db push`**, ninguno diferido al Log, y re-auditoría pendiente por tratarse de una migración (§1.1).

El informe de la re-auditoría recibe el mismo tratamiento cuando llegue.

---

## 2. Las 9 funciones de producción: **migración separada**

**No las pliegues dentro de 0022.** Van en su propia migración, **después** de cerrar el import.

### Por qué separadas

- 0022 ya tiene un alcance definido y una auditoría encima. Sumarle la reescritura de nueve funciones agranda el diff y vuelve menos filosa la re-auditoría, justo en la migración que más precisión necesita.
- Las migraciones chicas y delta-only son más fáciles de verificar por catálogo.
- Acoplar un arreglo de seguridad de producción a una feature nueva significa que el arreglo sale cuando la feature esté lista. Si el import se complica, el agujero queda abierto esperándolo.

### Por qué no es urgente al punto de interrumpir

Verifiqué producción: **27 usuarios de Auth, 27 perfiles, cero huérfanos en las dos direcciones.** No existe hoy ninguna sesión autenticada sin perfil, que es la condición necesaria para que la guarda falle. **No es explotable hoy.**

Pero sí es un agujero latente y por eso está cargado como **Alta** en el Log (`recfamWK93drsaCiQ`): alcanza con que un alta cree el usuario en `auth.users` y falle al insertar el perfil para que aparezca un huérfano. No depende de que alguien ataque, depende de que algo falle a medias.

### Qué va a llevar esa migración, cuando la tomemos

- Reescribir las nueve guardas con **evaluación afirmativa** de `is_admin()`, no por negación.
- Un test con **JWT `authenticated` sin perfil** que verifique que cada una aborta.
- Revisar si el mismo patrón por negación aparece en **políticas RLS** o en cualquier otra condición booleana que pueda recibir NULL. El error no es un descuido puntual, es una forma de escribir la condición.
- Ceremonia completa, como toda migración.

**No la empieces ahora.** Primero se cierra el import.

---

## 3. Qué sigue

1. Versionar el informe verbatim con la nota de triage.
2. **Re-auditoría de Codex sobre el PR #56**, con los cinco hallazgos ya corregidos. El prompt lo paso yo.
3. Con la re-auditoría limpia: `db push` por el runbook gateado, que **corre Luciano**.
4. Verificación de catálogo, `migration list` Local = Remote, regen de `types.ts --linked`.
5. Merge, autorizado por Luciano.
6. Recién después, la migración de las nueve funciones.

---

## Fuera de alcance

- Empezar la migración de las nueve funciones.
- Los dos riesgos registrados sin acción (cancelación de ausencia, edición manual sin auditoría).
- Configuración de Gmail.

---

## Definición de Done

- [ ] `docs/audits/FB-PI-AUD-11.md` commiteado verbatim, en bloque de código, con la nota de triage debajo.
- [ ] Decisión sobre las 9 funciones registrada en el PR: migración separada, después del import.
- [ ] CI verde.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11-D.md`.

**El `db push` no se pide hasta que la re-auditoría vuelva limpia.**
