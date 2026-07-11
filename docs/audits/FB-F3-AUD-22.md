# FB-F3-AUD-22 — Informe de re-auditoría acotada (Codex)

Alcance: solo el fix de FB-F3-22 (commit aaa6cca sobre PR #16) que cierra el hallazgo Medio de FB-F3-AUD-21.

## Hallazgos
Ninguno dentro del alcance de FB-F3-AUD-22.

## Verificaciones
- `page.tsx` mantiene `saldoLoadFailed` separado de `saldoByUser`; si falla la query de saldo, setea el flag en `true` y conserva la cola renderizable.
- `AprobacionesTable` muestra `No se pudo calcular el saldo.` solo para ítems de ausencia cuando `saldoLoadFailed=true`.
- El caso de saldo cargado OK sigue mostrando el badge normal.
- Ítems de documento no muestran error de saldo.
- Las acciones `approveAusencia` / `rejectAusencia` no fueron alteradas; la cola sigue visible y accionable.
- Copy es-AR y no técnico.
- Tests focalizados locales: 18/18 pasan.
- PR #16: checks verdes, incluida integración Supabase local.

## Veredicto
Limpio para merge. El hallazgo Medio de FB-F3-AUD-21 queda cerrado.
