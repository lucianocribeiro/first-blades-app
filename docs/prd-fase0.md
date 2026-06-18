# PRD — Fase 0: Foundation (Portal First Blades) · v0.3

> Lo construye el chat de Fase 0 (Claude Code). Lo audita Codex. Base sobre la que se montan todos los módulos. Alineado con la Constitución v0.3.

## Para adjudicar (2 puntos)
1. **Método de auth.** Propuesta: **email + contraseña con flujo de invitación** (el admin crea el usuario en Gestión de Usuarios → Supabase envía invitación → el usuario define su contraseña en el primer ingreso). Alternativa: magic link. **Recomiendo invitación + contraseña.**
2. **Primer admin (bootstrap):** sembrar el primer admin vía migración/seed con un email por env. **Necesito el email del primer admin.**

*(Test stack: Vitest + Playwright. CI: GitHub Actions.)*

## Objetivo
Parar el repo, la base de datos y el shell sobre los que se construyen todos los módulos, con auth, los 3 roles y Gestión de Usuarios funcionando.

## En alcance
- **Scaffold:** Next.js (App Router, TS strict) + Tailwind con los tokens del sistema de diseño (fondo blanco, `logo.fb.png`).
- **Supabase:**
  - Schema base: `profiles` (con `supervisor_id`), `documents`, `pasaje_requests` (con `solicitante_id` + `empleado_id` + `motivo_viaje`), `ausencia_requests`, `rotation_groups`, `rotation_assignments` (con `estado_dia` + `motivo_ausencia`), `procedures`, `audit_log`.
  - Enums: `employee_status`, `approval_status`, `user_role` (admin/supervisor/empleado), `estado_dia` (4 estados), `motivo_ausencia`, `motivo_viaje`.
  - **RLS para los 3 roles** en cada tabla (constitución §6), incluida la lógica de equipo del Supervisor (`supervisor_id = auth.uid()`).
  - Storage de documentos con control de acceso + signed URLs.
  - Tipos TypeScript generados y commiteados.
- **Auth:** Supabase Auth (método según adjudicación), login + logout, bootstrap del primer admin.
- **Shell responsivo:** layout + sidebar **sensible a los 3 roles** con todos los ítems del menú (constitución §4); cada ítem rutea a un placeholder, salvo los funcionales.
- **Gestión de Usuarios — FUNCIONAL:** el admin crea usuarios y asigna rol **Admin / Supervisor / Empleado**; puede asignar el `supervisor_id` de un empleado.
- **Infra de purgatorio:** utilidades reutilizables + `audit_log`, listas para pasajes/ausencias/documentos en fases siguientes.
- **Sistema de diseño:** tokens, fondo blanco, `logo.fb.png`, tipografía, componentes base (botón, input, select, badge de estado, tabla, modal de previsualización).
- **Copy:** `/lib/copy` inicial en es-AR.
- **CI:** GitHub Actions con typecheck, lint, test, build. Tests base, incluido **test de límite de rol para los 3 roles** (Empleado solo lo propio; Supervisor solo su equipo; Admin todo).
- **Materializar `CLAUDE.md` y los skills** en sus rutas.

## Fuera de alcance (placeholders / fases siguientes)
Contenido real de Mi Perfil, Equipo, Calendario, Solicitud de Pasaje, Solicitud de Ausencia, Procedimientos (Fases 1–2) · **Viáticos en Google Workspace** (Fase 3, externo, solo link) · deploy productivo a Vercel (Fase 4) · Visma (Fase 2). La lógica detallada del calendario (alertas, días de trámite, roster, reglas de viaje, carga de 60 días) es Fase 2.

## Permisos / RLS (constitución §6)
- `profiles`: Empleado/Supervisor SELECT su fila; Supervisor además SELECT su equipo; sin UPDATE; Admin completo.
- `documents` / `pasaje_requests` / `ausencia_requests`: el solicitante INSERT/SELECT lo propio (Supervisor además para/de su equipo en pasajes); Admin completo.
- `rotation_*`: Empleado SELECT su calendario; Supervisor SELECT su calendario + el de su equipo; sin escritura; Admin completo.
- `procedures`: Empleado/Supervisor SELECT; Admin completo.

## Criterios de aceptación (testeables)
- [ ] Un admin crea un usuario, le asigna rol (Admin/Supervisor/Empleado) y, si es empleado, su supervisor; el usuario puede loguearse.
- [ ] Un Empleado solo ve los ítems de su rol; no puede leer la fila `profiles` de otro (test RLS).
- [ ] Un Supervisor ve su propio perfil/calendario y el calendario de su equipo (lectura); no ve datos de empleados fuera de su cargo ni accede a Gestión/admin de calendario (test RLS).
- [ ] Todas las tablas tienen RLS; las migraciones aplican limpio y los tipos se generan.
- [ ] Login/logout funcionan; el primer admin queda sembrado.
- [ ] Tokens aplicados, fondo blanco, `logo.fb.png` visible.
- [ ] Todo el copy visible en español (es-AR).
- [ ] CI en verde: typecheck, lint, test, build.

## Dependencias (las provee Luciano)
- Proyecto Supabase + URL/keys (env). · Repo GitHub. · `logo.fb.png` en `/public`. · Email del primer admin.
