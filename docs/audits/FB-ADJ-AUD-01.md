# FB-ADJ-AUD-01

## Hallazgos

**Alta — create → resolve no garantiza "sin huérfanas" ante excepción/timeout/cleanup fallido.**
Ubicación: [solicitud-ausencia/actions.ts (line 48)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-ausencia/actions.ts:48) y [solicitud-pasaje/actions.ts (line 88)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-pasaje/actions.ts:88).
Evidencia: ambas actions insertan pendiente, luego llaman la RPC, y sólo limpian si `.rpc()` retorna `{ error }` ([ausencia (line 75)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-ausencia/actions.ts:75), [pasaje (line 112)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-pasaje/actions.ts:112)). No hay try/catch alrededor del tramo posterior al insert. Además, si el DELETE compensatorio falla, sólo se loguea y se devuelve `{ ok:false }`, dejando la fila pendiente posible ([ausencia (line 80)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-ausencia/actions.ts:80), [pasaje (line 117)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-pasaje/actions.ts:117)); incluso hay test que acepta ese caso en ausencia ([test (line 381)](/Users/lucianocr/Desktop/Dev/first-blades-app/tests/unit/solicitud-ausencia.test.ts:381)).
Regla: FB-ADJ-01 exige "sin solicitudes huérfanas"; si la resolución falla, la action debe borrar la solicitud o dejarla consistente, incluyendo excepción/timeout.
Recomendación: mover el camino admin-para-sí a una RPC transaccional chica que cree y apruebe en una sola transacción. Un try/catch con cleanup mejora exceptions normales, pero no garantiza timeout/crash entre requests.

**Media — CLAUDE.md queda autocontradictorio con la Constitución v0.7.1.**
Ubicación: [CLAUDE.md (line 55)](/Users/lucianocr/Desktop/Dev/first-blades-app/CLAUDE.md:55) y [CLAUDE.md (line 70)](/Users/lucianocr/Desktop/Dev/first-blades-app/CLAUDE.md:70).
Evidencia: arriba lista correctamente las dos excepciones, incluida admin-para-sí, pero la tabla de menú sigue diciendo `Solicitud de Pasaje | ✓ (consulta)` y `Solicitud de Ausencia | ✓ (consulta)`, y la nota posterior dice que admin entra en "modo consulta (no envía)". También mantiene "Formularios" en vez de "Ingreso" ([CLAUDE.md (line 75)](/Users/lucianocr/Desktop/Dev/first-blades-app/CLAUDE.md:75)).
Regla: docs operativas consistentes con Constitución; CLAUDE.md debe listar los dos paths y dejar claro que admin-por-otro va a pendiente.
Recomendación: actualizar esa tabla y nota para reflejar admin auto-envío self-only y el renombre "Ingreso".

**Baja — El form admin todavía muestra banner genérico de purgatorio.**
Ubicación: [SolicitudAusenciaForm.tsx (line 117)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-ausencia/SolicitudAusenciaForm.tsx:117) y [SolicitudPasajeForm.tsx (line 138)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-pasaje/SolicitudPasajeForm.tsx:138).
Evidencia: ambos formularios renderizan `copy.purgatorio.infoMessage`, cuyo texto dice "Tu solicitud será revisada por Administración." ([copy (line 91)](/Users/lucianocr/Desktop/Dev/first-blades-app/lib/copy/index.ts:91)), incluso cuando `isAdmin=true` y el envío se auto-aprueba.
Regla: diálogo/copy de admin debe comunicar que no pasa por revisión.
Recomendación: condicionar el banner para admin o usar copy específico de auto-aprobación.

## Veredicto

No limpio. Bloquearía merge hasta resolver el hallazgo Alta de atomicidad/sin huérfanas. Lo demás central se ve bien: excepción acotada a admin-para-sí, pasaje fuerza `empleado_id = profile.id` para admin, ausencia usa `profile.id`, las RPCs mantienen guarda `auth.uid()` + `is_admin()`, `reviewed_by`/`reviewed_at`/`audit_log` quedan cubiertos por RPC, no-retroactiva aplica server-side también a admin, no hay cambios de esquema/RLS/RPC, no detecté secretos, y `gh pr checks 37` está verde en los 3 jobs + Vercel.
