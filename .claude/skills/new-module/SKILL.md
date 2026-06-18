---
name: new-module
description: >
  Scaffold de un módulo nuevo del Portal First Blades, sensible a rol y
  respaldado por RLS. Usar SIEMPRE que se agregue un módulo o pantalla nueva al
  portal (ej. Mi Perfil, Equipo, Calendario, Procedimientos). Crea la ruta en
  /app, el gating por rol, el consumo de datos con RLS, los textos en /lib/copy
  (es-AR), los componentes sobre design-system y los tests, incluido el test de
  límite de rol para los 3 roles.
---

# Skill: new-module

Receta para sumar un módulo de forma consistente. No reinventes layout ni
estilos: usá la skill `design-system` y los componentes existentes.

## Pasos

1. **Ruta** en `/app` (App Router), bajo el AppShell. Título + ícono + subtítulo
   en la Topbar.
2. **Gating por rol** en el server (no solo en la UI): resolvé el rol del usuario
   y mostrá/permití según el menú definido en `CLAUDE.md`. La UI oculta; **la RLS
   autoriza**.
3. **Datos** vía cliente Supabase respetando RLS. Nunca uses el service role para
   sortear los permisos del usuario.
4. **Copy** en `/lib/copy` (es-AR). Sin strings hardcodeados.
5. **Componentes** sobre `design-system` (Card, Table, Button, StatusBadge, etc.).
6. **Estados de UI**: loading, vacío, error, sin-permiso, todos en es-AR.
7. **Tests**:
   - Render y flujos felices.
   - **Test de límite de rol para los 3 roles**: empleado solo lo propio;
     supervisor solo su equipo; admin completo. Incluí el caso negativo
     (empleado/supervisor NO pueden leer/escribir fuera de su alcance).
8. **DoD**: cerrá con la skill `dod-checklist`.

## Si el módulo tiene un flujo de envío con aprobación

Usá la skill `purgatorio-form` (pasajes, ausencias, documentos). No implementes
un flujo de aprobación propio por fuera de ese patrón.

## Placeholders (Fase 0)

En Fase 0, los módulos no funcionales existen como **placeholder** ruteado desde
el menú (salvo Gestión de Usuarios, que va funcional). El placeholder usa el
AppShell + una Card "Próximamente" en es-AR.
