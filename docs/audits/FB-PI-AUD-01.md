```text
# FB-PI-AUD-01 — Auditoría del diff de FB-PI-01

- **Fecha:** 2026-09-14
- **Rama auditada:** `feat/fb-pi-01-campanita-aprobaciones`
- **Base:** `main` @ `9fd9208`
- **HEAD auditado:** `0719d63`
- **Referencias:** `docs/constitucion.md` v0.8 + `docs/prompts/FB-PI-01.md` + `docs/audits/FB-PI-01-INSPECT.md`

## Resultado

SIN HALLAZGOS.

El diff cumple el alcance de `FB-PI-01`: el conteo usa una fuente compartida con la bandeja (`pendientesQuery()` en `lib/aprobaciones.ts`), suma documentos + ausencias + pasajes con `estado = 'pendiente'`, usa `createServerClient()` para la lectura del layout, lee explícitamente `{ error }` de PostgREST, degrada a campanita sin badge ante fallo, no consulta para supervisor/empleado, no introduce migraciones ni secretos, y no toca el bug fuera de alcance de `audit_log` en `aprobaciones/actions.ts`.

La bandeja no tiene hoy filtro de negocio adicional por motivo en ausencias: según `docs/audits/FB-PI-01-INSPECT.md`, ese alcance cambió en FB-F4-05 a ausencias pendientes de cualquier motivo. Por eso el helper compartido filtra solo por `estado = 'pendiente'` y coincide con las filas visibles.

## Verificación

- `npm run typecheck` — OK.
- `npm test -- tests/unit/aprobaciones-contador.test.ts tests/unit/topbar-campanita.test.tsx` — OK, 38 tests.
- `npm test` — OK, 61 archivos / 813 tests.
- `npm run test:e2e -- tests/e2e/campanita.spec.ts` — no verificable localmente: primero el sandbox bloqueó el bind a `0.0.0.0:3000` (`EPERM`); reintentado fuera del sandbox, Playwright arrancó pero abortó antes de ejecutar los casos por falta de variables `E2E_*` (`E2E_EMPLEADO_EMAIL`). No se observó fallo funcional de la app en esta corrida.

## Notas

- El diff agrega tests unitarios de coincidencia helper ↔ bandeja y límite de rol para admin/supervisor/empleado.
- El e2e nuevo cubre badge correcto, navegación a `/aprobaciones`, bajada del contador tras aprobar, cero sin badge y no-admin sin badge/link, pero requiere el entorno e2e sembrado.
```

---

> **Nota del Developer (no es parte del informe de Codex):** Codex no pudo correr el e2e localmente por falta de las variables `E2E_*`. Ese job corrió **verde en CI** en el PR #50 (run `34859686352`, job "E2E Playwright (stack efímero)"): 30 tests pasaron y 1 fue flaky, ajeno a esta historia (`gestion-usuarios.spec.ts`). Los 5 tests de `campanita.spec.ts` pasaron al primer intento. CI es la compuerta autoritativa.
