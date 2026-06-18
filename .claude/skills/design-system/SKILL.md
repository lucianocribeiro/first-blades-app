---
name: design-system
description: >
  Sistema de diseño del Portal First Blades: tokens de marca, configuración de
  Tailwind, el chrome de la app (sidebar colapsable, topbar), los componentes
  base (botón, input, select, badge de estado, tabla, modal, card) y la pantalla
  de login. Usar SIEMPRE que se construya o ajuste UI: para crear cualquier
  pantalla, componente o layout del portal. Garantiza fondo blanco, paleta de
  marca, español (es-AR) y consistencia visual entre módulos.
---

# Skill: design-system

Fuente visual única del portal. Toda UI nueva sale de acá. Si algo no está
definido, seguí los tokens y patrones de abajo antes de inventar.

## Tokens de marca (CSS variables / Tailwind theme)

| Token | Valor | Uso |
|---|---|---|
| `--color-primary` | `#0D7EC7` | acciones, ítem activo, links, íconos primarios |
| `--color-secondary` | `#003E68` | fondo del sidebar, títulos |
| `--color-neutral` | `#666666` | texto secundario |
| `--color-bg` | `#FFFFFF` | fondo base (blanco) |
| `--color-surface` | `#F4F6F8` | fondo del área de contenido |
| `--color-border` | `#E2E8F0` | bordes de inputs/cards |
| `--color-success` | `#2E7D32` | aprobado/emitido |
| `--color-error` | `#C62828` | rechazado/error |
| `--color-warning` | `#F9A825` | pendiente |

Exponé los tokens como CSS variables y mapealos en `tailwind.config`. No uses
colores hardcodeados fuera de estos tokens.

Tipografía: system/Inter por defecto. Logo: `/public/logo.fb.png`.

## Chrome de la app (AppShell)

**Sidebar** (componente `Sidebar`):
- Fondo `--color-secondary` (azul oscuro), texto blanco.
- Logo `logo.fb.png` arriba, sobre una franja blanca.
- Ítems: ícono + label. Ítem activo en pastilla `--color-primary` con texto blanco.
- Divisor antes de "Cerrar sesión" al pie.
- **Colapsable con hamburguesa** (botón en la topbar):
  - Escritorio: arranca expandido; colapsar oculta el sidebar y el contenido toma todo el ancho; volver a expandir lo trae. (Variante opcional: colapsar a riel de solo íconos.)
  - Mobile: arranca oculto; la hamburguesa lo abre como panel deslizante (drawer) sobre el contenido.
- Los ítems se renderizan **según el rol del usuario** (ver menú en `CLAUDE.md`). Ocultar por rol en la UI es complementario a la RLS, nunca el único control.

**Topbar** (componente `Topbar`):
- Fondo blanco.
- Izquierda: botón hamburguesa + título de página con ícono + subtítulo.
- Derecha: fecha (locale es-AR, ícono calendario) · campana de notificaciones con badge de conteo · avatar + nombre + chevron (menú de usuario).

**Área de contenido**:
- Fondo `--color-surface` (gris claro).
- Contenido en tarjetas blancas, esquinas redondeadas (~12px), sombra suave, padding generoso.

## Componentes base

- `Button`: `primary` (relleno `--color-primary`, texto blanco), `secondary` (outline azul). Soporta ícono + texto. Estados hover/disabled/loading.
- `Input`, `Select`, `DatePicker`, `Textarea`: borde `--color-border`, ícono opcional adelante, label arriba. Campos prellenados/solo-lectura en gris (`--color-surface`). `Textarea` con contador (ej. `0/200`).
- `StatusBadge`: mapea `approval_status` → `pendiente` (warning, ícono reloj) · `aprobado` (success, ícono check) · `rechazado` (error). El mismo patrón sirve para `employee_status`.
- `Card`: contenedor blanco redondeado con sombra suave.
- `Table`: encabezado, filas zebra opcional, primera columna sticky para grillas anchas.
- `Modal` / `PreviewModal`: para previsualizar documentos/imágenes.
- `InfoBanner`: banner celeste informativo (ej. "Tu solicitud será revisada por Administración").

## Pantalla de Login

- Layout partido: imagen a un lado, tarjeta blanca centrada al otro.
- Tarjeta: logo arriba, "Bienvenido", campo Usuario y Contraseña (con ícono y toggle de ver/ocultar), link "¿Olvidaste tu contraseña?", botón primario "Ingresar", pie "Acceso seguro".

## Reglas

- Fondo base **blanco**. Nada de dark mode salvo pedido explícito.
- Todo el texto visible en **es-AR**, tomado de `/lib/copy` (no hardcodear strings).
- Accesibilidad básica: contraste suficiente, foco visible, labels asociadas, targets táctiles cómodos.
- Reusá estos componentes; no dupliques estilos por módulo.
