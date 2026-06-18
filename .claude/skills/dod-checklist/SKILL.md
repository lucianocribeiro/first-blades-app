---
name: dod-checklist
description: >
  La compuerta de Definición de Done del Portal First Blades (constitución §13).
  Usar SIEMPRE al cerrar una historia o módulo, antes de considerarlo terminado,
  y como guía de lo que Codex audita. Verifica criterios del PRD, tests (incluido
  el de límite de rol para los 3 roles), CI verde, RLS por tabla, auditoría
  limpia, copy es-AR y ausencia de secretos.
---

# Skill: dod-checklist

Una historia/módulo **no está done** hasta cumplir todo esto. Corré esta lista
antes de marcar como terminado y antes de pasar a Codex.

## Checklist

- [ ] **Criterios de aceptación del PRD** de la fase cumplidos (uno por uno).
- [ ] **Tests verdes**, incluido el **test de límite de rol para los 3 roles**
      (empleado solo lo propio · supervisor solo su equipo · admin completo), con
      casos negativos.
- [ ] **CI en verde**: typecheck, lint, test, build (GitHub Actions).
- [ ] **RLS testeada por tabla** tocada, para los 3 roles.
- [ ] **Integridad del purgatorio**: nada llega a `aprobado` sin admin (donde aplique).
- [ ] **Storage**: signed URLs + validación + control de acceso (donde aplique).
- [ ] **Copy 100% en es-AR**, desde `/lib/copy`, sin strings hardcodeados.
- [ ] **Sin secretos** en el código; solo variables de entorno.
- [ ] **Tipos TS** de Supabase regenerados y commiteados (si hubo migración).
- [ ] **Auditoría de Codex limpia** contra el PRD + la constitución.

## Rol de Codex

Codex audita los diffs **contra el PRD + la constitución**; **no escribe código
de features**. Foco de auditoría (constitución §12): límite de rol/RLS,
integridad del purgatorio, carga de archivos, aprobaciones sin tokens abiertos,
sin secretos.
