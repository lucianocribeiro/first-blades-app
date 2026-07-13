# FB-F3-AUD-23 — Informe de auditoría (Codex)

Alcance: FB-F3-23 (PR #17) — selección de rango, server action de upsert best-effort y reporte por día. Sin migración.

## Hallazgos

### Alto — El modal de celda bloquea el segundo shift-click del rango
- **Ubicación:** `RosterGrid.tsx:57`, `RosterGrid.tsx:134`, `components/ui/Modal.tsx:25`, `tests/setup.ts:33`
- **Evidencia:** el primer click normal siempre hace `setSelected(...)` y monta `CellEditModal`. Ese modal usa `<dialog>.showModal()`, que en navegador bloquea/inertiza el resto de la página. Por lo tanto, el segundo `shift-click` sobre otra celda no es ejecutable en el flujo real hasta cerrar el modal de celda. Los tests no lo detectan porque el polyfill de jsdom solo agrega `open` y no replica la inertización nativa.
- **Regla violada:** selección de rango "click en la celda inicial + shift-click en la final" dentro de una fila.
- **Recomendación:** ajustar la UX para que fijar el ancla no abra un modal bloqueante antes del segundo click, o usar otro gesto claro para edición de celda vs selección de rango. Agregar cobertura browser/e2e o un test que modele este bloqueo.

### Bajo — Copy de éxito total no usa el conteo
- **Ubicación:** `RangeEditModal.tsx:75`, `lib/copy/index.ts:541`
- **Evidencia:** en éxito total el reporte muestra "Se aplicó correctamente a todos los días seleccionados."; solo en fallo parcial muestra "Se aplicaron X de N días."
- **Regla violada:** copy esperado para reporte por rango: "Se aplicaron X de N días".
- **Recomendación:** usar el conteo también en éxito total, por ejemplo "Se aplicaron 3 de 3 días."

## Verificado sin hallazgos
- `upsertRotationRange` llama `requireAdmin()` antes de validar/escribir y usa `createServerClient()`, no service role. Rechaza `dia_tramite` upfront. El upsert es por día con `onConflict: 'user_id,fecha'`, reporta fallas por día con copy legible, y calcula `es_estimado` con `fecha > getBusinessToday()` en zona AR. `getDateRange()` es inclusivo y ordena correctamente. El server action solo recibe un `user_id`, y la UI solo arma rango si el ancla pertenece a la misma fila.

## Verificación ejecutada
- Unitarios FB-F3-23: 48 passed.
- Integración DB-backed: 4 skipped localmente porque PostgreSQL no está disponible (corre en CI).

## Veredicto
Requiere fix: priorizar el bloqueo del flujo real de shift-click por el modal nativo. El punto de copy es menor.

## Resolución
Cerrado con **FB-F3-24**: el gesto que fija el ancla ya no monta `CellEditModal` (la rama `shiftKey` no llama `setSelected`); flujo shift-click (ancla, sin modal) → shift-click misma fila (abre `RangeEditModal`); Esc/click simple cancela; copy de éxito unificado a "Se aplicaron N de N días" + key muerta eliminada. Guard RTL de regresión agregado. Re-auditado limpio en **FB-F3-AUD-24**. Nota de deuda: no hay e2e en CI (solo unit + integración); riesgo residual de browser cubierto por el guard RTL.
