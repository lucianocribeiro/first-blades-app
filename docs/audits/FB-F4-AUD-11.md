# FB-F4-AUD-11 — Re-auditoría acotada: visibilidad post-aprobación para el empleado viajero (pasajes pedidos por supervisor)

> Re-auditoría acotada de PR #31 `feat/fb-f4-14-cancelar-editar-app -> main`, limitada al hallazgo Medio de `FB-F4-AUD-10` corregido por `FB-F4-15`.
> Fecha: 2026-07-30.

## Hallazgos

Ninguno en el alcance de FB-F4-AUD-11.

## Verificación

- El fix quedó acotado a `solicitud-pasaje`, copy, tests y prompt. No hay cambios en `supabase/`, RLS, RPCs, esquema ni en el flujo de ausencias.
- La query de "Mis solicitudes" de pasaje ahora usa `.or('solicitante_id.eq.<id>,empleado_id.eq.<id>')` en `page.tsx:70`. Esto no elude RLS: la policy `pasajes_select` ya permite `solicitante_id = auth.uid()` o `empleado_id = auth.uid()` en `0001_init.sql:304`. La app dejó de filtrar de más.
- La tabla recibe `viewerId` y distingue:
  - `—` cuando el usuario pidió para sí mismo.
  - `Para: <nombre>` cuando el usuario pidió para otro.
  - `Pedido por: <nombre>` cuando el usuario es el viajero y otro lo pidió.

  Eso está en `MisSolicitudesPasajeTable.tsx:28`. El join a `solicitante_profile` trae sólo `full_name,email`, coherente con lo que ya se muestra del empleado.
- Los tests cubren el caso nuevo supervisor→empleado con marca post-aprobación visible en `mis-solicitudes-post-aprobacion.test.tsx:134`, y la forma `.or()` de la query en `solicitud-pasaje.test.ts:452`. Un `.or()` sobre la misma tabla no duplica filas; cuando `solicitante_id = empleado_id`, PostgREST devuelve la fila una vez.
- Verificación local: `npm run typecheck` pasó; `npm run test -- solicitud-pasaje.test.ts mis-solicitudes-post-aprobacion.test.tsx` pasó con 32 tests. PR #31 está limpio y CI verde: typecheck/lint/tests/build, integración Supabase local, e2e Playwright y Vercel.

## Veredicto

Aprobado para el alcance de FB-F4-AUD-11. El hallazgo Medio de FB-F4-AUD-10 quedó resuelto sin regresión visible; PR #31 queda listo para gate de Luciano, sin runbook.
