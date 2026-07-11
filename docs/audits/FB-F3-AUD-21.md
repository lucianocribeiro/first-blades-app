# FB-F3-AUD-21 — Informe de auditoría (Codex)

Alcance: FB-F3-21 (PR #16) — helper de cálculo, tres superficies, scope por rol y alerta de exceso. No re-audita 0013, la cola ni el formulario.

## Hallazgos

### Medio — El badge de saldo en Aprobaciones oculta fallas de carga
- **Ubicación:** `app/(app)/aprobaciones/page.tsx:61`, `tests/unit/aprobaciones-page-saldo.test.ts:117`
- **Evidencia:** si falla la query de `rotation_assignments`, la página solo hace `console.error` y sigue renderizando la cola con `saldoByUser = {}`. El test nuevo lo fija explícitamente: "badge simplemente no aparece".
- **Regla violada:** el foco pedía errores visibles, sin degradar a `[]`/vacío ocultando fallas de query/RLS.
- **Recomendación:** tratar `saldoError` igual que las demás superficies: mostrar `copy.errors.generic` o un aviso visible de que no se pudo cargar el saldo, sin presentar la ausencia de badge como si fuera dato válido. Mantener que el badge no bloquee la aprobación cuando sí cargó correctamente.

## Verificaciones limpias
- `computeSaldoDiasTramite` es helper único y puro, derivado de `rotation_assignments`, sin tabla/contador/caché.
- `es_estimado = true` cuenta como consumo y se propaga solo como metadata de display.
- El rango anual usa `getBusinessToday()` vía `getYearRange()`, con filtros inclusivos `gte`/`lte`.
- Tope anual centralizado en `TOPE_DIAS_TRAMITE_ANUAL = 3`; `restantes` puede quedar negativo y `excedido` se marca con `consumidos > 3`.
- Scope de calendario: empleados scopeados por rol y luego `rotation_assignments.in('user_id', employeeIds)`.
- Scope de solicitud de ausencia: `.eq('user_id', profile.id)` explícito.
- Scope del badge: `.in('user_id', solicitanteIds)` derivado de la cola admin-only.
- El badge es informativo: no altera `approveAusencia`/`rejectAusencia` ni la revalidación de FB-F3-20.
- Copy visible usa "Planificado"; no encontró `es_estimado`, `umbral`, `RPC` ni `enum` expuestos al usuario.

## Veredicto
Requiere fix antes del merge. Es un fix de manejo de error en la superficie de Aprobaciones, no solo-tests.

## Resolución
Cerrado con **FB-F3-22** (fix de manejo de error): `page.tsx` señaliza `saldoLoadFailed` separado de `saldoByUser`; `AprobacionesTable` muestra un estado de error visible ("No se pudo calcular el saldo.") en vez de omitir el badge. Re-auditado limpio en **FB-F3-AUD-22**.
