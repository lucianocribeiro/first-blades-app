# FB-ADJ-AUD-02

## Hallazgos

**Media — Constitución queda desactualizada con el fix 0019.**
Ubicación: [docs/constitucion.md (line 255)](/Users/lucianocr/Desktop/Dev/first-blades-app/docs/constitucion.md:255).
Evidencia: la decisión v0.7.1 todavía dice "sin migración" y describe el mecanismo viejo: la Server Action crea pendiente, invoca la resolver y borra si falla. El PR ahora agrega [0019_admin_crear_aprobar.sql (line 45)](/Users/lucianocr/Desktop/Dev/first-blades-app/supabase/migrations/0019_admin_crear_aprobar.sql:45) con RPCs transaccionales `crear_aprobar_ausencia_admin` / `crear_aprobar_pasaje_admin`, y las actions ya llaman una sola RPC.
Regla: la Constitución es fuente de verdad; no debe conservar una arquitectura descartada, especialmente en un flujo de auto-aprobación y migración.
Recomendación: actualizar esa entrada o agregar una entrada FB-ADJ-02 indicando migración 0019, RPC transaccional crear+aprobar y eliminación del cleanup compensatorio.

## Confirmaciones

- El Alta funcional quedó cerrado: el branch admin en [ausencia (line 40)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-ausencia/actions.ts:40) y [pasaje (line 30)](/Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-pasaje/actions.ts:30) es un único `.rpc()`, sin insert + resolve + delete.
- La migración 0019 cumple el molde §6.1: `SECURITY DEFINER`, `SET search_path = public`, guarda `auth.uid() IS NULL OR NOT public.is_admin()`, self-only con `auth.uid()` como `user_id`/`solicitante_id`/`empleado_id`, reuso de `resolver_*_request`, y `REVOKE` de `PUBLIC`/`anon` + `GRANT` a `authenticated`.
- El rollback está probado contra Postgres real: los tests fuerzan fallo dentro de la resolver anidada con un CHECK temporal y verifican que no persisten request, calendario ni audit ([ausencia (line 169)](/Users/lucianocr/Desktop/Dev/first-blades-app/tests/integration/admin-auto-aprobacion.test.ts:169), [pasaje (line 300)](/Users/lucianocr/Desktop/Dev/first-blades-app/tests/integration/admin-auto-aprobacion.test.ts:300)).
- CLAUDE.md y el banner quedaron corregidos. `types.ts` es plausible para las firmas SQL. No vi secretos ni DDL fuera de las dos funciones nuevas. `gh pr checks 37` está verde en typecheck/lint/tests/build, integración RLS, e2e y Vercel.

## Veredicto

No limpio por el hallazgo documental en Constitución. Funcionalmente, la atomicidad/sin huérfanas y self-only están cerrados. Tras corregir `docs/constitucion.md`, quedaría apto para versionar informe y seguir con FB-ADJ-RUN-01.
