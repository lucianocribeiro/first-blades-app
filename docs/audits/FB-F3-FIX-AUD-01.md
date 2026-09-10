# FB-F3-FIX-AUD-01 — Auditoría de Codex

- **ID:** FB-F3-FIX-AUD-01
- **PR auditada:** #49
- **Rama:** `fix/fb-f3-fix-01-celdas-estimadas`
- **Commit auditado:** `c5aa369`
- **Fecha:** 2026-09-10
- **Bug del Log:** `recO3SGuYGiB2qEJ3`
- **Veredicto:** `Requiere fix — solo por gobernanza (falta de CI remoto). Código del fix: sin hallazgos bloqueantes.` **→ Resuelto** (ver Resolución)

---

# FB-F3-FIX-AUD-01 — Informe de auditoría (Codex)

Alcance: fix del render de celdas estimadas (FB-F3-FIX-01, commit c5aa369). Bug del Log recO3SGuYGiB2qEJ3.

## Hallazgo
### Medio — Falta evidencia de CI remoto con e2e
- **Ubicación:** `.github/workflows/ci.yml:100` y estado de rama local.
- **Evidencia:** `gh pr view` / `gh pr checks` devuelven "no pull requests found for branch fix/fb-f3-fix-01-celdas-estimadas"; `git branch -vv` muestra la rama sin upstream. El workflow sí define el job "E2E Playwright (stack efímero)" y corre `npm run test:e2e`, pero no hay checks remotos verificables para este commit.
- **Regla violada:** gobernanza del pedido ("CI verde incluido el job e2e").
- **Recomendación:** publicar la rama / abrir PR y verificar que pasen unit, integration y e2e. No requiere cambio de código.

## Controles verificados
- `getCellVisual()` en helper compartido, sin composición runtime: mapas literales completos para real y estimado; elige mapa por `es_estimado`.
- CSS compilado confirmado tras `npm run build`: contiene `bg-calendar-enFranco/35`, `bg-calendar-enViaje/35`, `bg-calendar-fueraTrabajo/35`, las sólidas y `bg-calendar-vacio`.
- Alcance general: `RosterGrid.tsx` usa el helper para lectura y edición; `page.tsx` pasa `readOnly={!isAdmin}` para los 3 roles.
- Intención visual preservada: `vacio = #CBD5E1`, estimados `/35`.
- Tests dirigidos: 57 passed en `calendario-utils`, `calendario-clases-tailwind`, `calendario-grid`. `npm run build` pasó.
- Sin migraciones en el commit del fix.

## Veredicto
Requiere fix, solo por gobernanza: falta evidencia de CI remoto verde con e2e. Código del fix: sin hallazgos bloqueantes.

## Resolución
Gobernanza cerrada: PR #49 abierto y CI completo verde (run 34502994221) — typecheck/lint/unit/build, integración RLS contra Postgres real, y **E2E Playwright corrido (no skip), 26 tests, incluidos el guard de la celda estimada (fondo pintado ≠ transparente), la regresión de franco de 6 días futuros y el borde de idempotencia**. El único commit agregado tras la auditoría (`550f06b`) es solo-tests (desambiguación de locator e2e), exento de re-auditoría. Código ya limpio en la auditoría.
