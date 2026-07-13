# FB-F3-AUD-24 — Informe de re-auditoría acotada (Codex)

Alcance: solo el fix de FB-F3-24 sobre PR #17 (gesto de selección de rango corregido). Cierra el Alto y el Bajo de FB-F3-AUD-23.

## Hallazgos
Ninguno.

## Evidencia principal
- El fix cierra el Alto: en `RosterGrid.tsx:78`, la rama `shiftKey` no llama `setSelected`, por lo que no monta `CellEditModal`. El primer shift-click solo fija `anchor`; el segundo shift-click en la misma fila limpia el ancla y abre `RangeEditModal` con `getDateRange()`.
- El modelo queda coherente: click simple limpia ancla y abre celda única en `RosterGrid.tsx:87`; shift-click en otra fila resetea el ancla sin modal; Esc cancela el ancla en `RosterGrid.tsx:49`.
- El copy del Bajo también está cerrado: `RangeEditModal.tsx:80` usa siempre "Se aplicaron N de N días", y la key muerta `todoOk` ya no aparece en app/lib/tests.

## Cobertura
- El guard RTL cubre directamente la clase de bug: `calendario-range-selection.test.tsx:63` falla si el primer shift-click vuelve a montar `CellEditModal` o `RangeEditModal`. También cubre rango misma fila, orden inverso, reset por otra fila, Esc y click simple. Sin e2e, queda un riesgo residual normal de browser, pero no bloqueante porque el bug era "se montó un modal"; el guard prueba que ya no se monta.
- Ejecutado: `vitest run` de los dos archivos → 17 tests passed.

## Veredicto
Limpio para merge. Alto y Bajo de AUD-23 cerrados.
