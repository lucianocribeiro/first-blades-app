# FB-PI-01-INSPECT — Inspección previa: campanita con contador de aprobaciones pendientes

- **Fecha:** 2026-09-14
- **Rama:** `feat/fb-pi-01-campanita-aprobaciones` (desde `main` @ `9fd9208`)
- **Prompt:** `docs/prompts/FB-PI-01.md` (Paso 0)
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** lectura de archivos del repo + lectura del código de Next.js instalado (`node_modules/next`, **15.5.19**). Sin queries a la base, sin escrituras, sin cambios de código de feature al momento de escribir este informe.

---

## 1. `app/(app)/aprobaciones/page.tsx` — query real de la bandeja

Server Component. `requireAdmin()` + `createServerClient()` (sesión del admin, **sujeto a RLS**). Tres queries en paralelo:

```ts
const [docsResult, ausenciasResult, pasajesResult] = await Promise.all([
  supabase
    .from('documents')
    .select('*, user_profile:profiles!documents_user_id_fkey(full_name, email)')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true }),
  supabase
    .from('ausencia_requests')
    .select('*, user_profile:profiles!ausencia_requests_user_id_fkey(full_name, email)')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true }),
  supabase
    .from('pasaje_requests')
    .select(
      '*, solicitante_profile:profiles!pasaje_requests_solicitante_id_fkey(full_name, email), empleado_profile:profiles!pasaje_requests_empleado_id_fkey(full_name, email)'
    )
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true }),
]);
```

Luego concatena las tres listas y ordena por `created_at`. **Cada fila devuelta es una fila de la tabla visible** (`AprobacionesTable` hace `items.map(item => <tr>)`, sin filtrado posterior). Las queries de `rotation_assignments` que siguen (saldo, previsualización de sobrescritura) son informativas por ítem y **no quitan ni agregan filas**.

Si **cualquiera** de las tres queries falla, la página muestra `copy.errors.generic` en lugar de la tabla.

### 1.1 ¿Hay scope de negocio superpuesto a la RLS? — **No (hoy).**

El único filtro es `estado = 'pendiente'` en las tres tablas. **No hay filtro por motivo** en ausencias.

⚠️ **Divergencia con la constitución.** §5 (`ausencia_requests`, línea 147) dice que "la cola de aprobación filtra por motivo + estado, y la action revalida el scope server-side (`estado='pendiente'` + `motivo_ausencia='dia_tramite'`)". Eso describe el estado de **Fase 3**. `FB-F4-05` lo retiró — está documentado en el código:

- `page.tsx`: *"ausencias pendientes de CUALQUIER motivo (FB-F4-05)"*.
- `aprobaciones/ausencia-actions.ts::isPendiente`: *"FB-F4-05: hasta acá esta bandeja también revalidaba motivo_ausencia === 'dia_tramite' […] ese chequeo se retira — el único scope que queda es 'pendiente'"*.

Consecuencia para FB-PI-01: el contador filtra **solo** por `estado = 'pendiente'` en las tres tablas y coincide con la bandeja. La nota de §5 queda desactualizada; **no se corrige en este PR** (la constitución la sostiene el chat PM) — se reporta para que la adjudiquen.

### 1.2 RLS de lectura relevante

- `documents_select`: `is_admin() OR user_id = auth.uid()` (0004).
- `pasajes_select`: `is_admin() OR solicitante_id = auth.uid() OR empleado_id = auth.uid() OR …` (0001).
- `ausencia_requests`: admin ve todo; no-admin lo propio (0012).

Para admin, la RLS devuelve todas las filas: el conteo con la sesión del admin es el conteo global. Para supervisor/empleado la misma query devolvería **sus** pendientes (no cero) — por eso el contador **no se consulta** para esos roles (decisión "solo admin"), y la RLS sigue siendo el control real.

## 2. `app/(app)/aprobaciones/actions.ts` (+ `ausencia-actions.ts`, `pasaje-actions.ts`) — revalidación

| Action | Éxito | Error "amigable" | Error genérico |
|---|---|---|---|
| `approveDocument` | `/aprobaciones`, `/mi-perfil` | — | sin revalidate |
| `rejectDocument` | `/aprobaciones`, `/mi-perfil` | — | sin revalidate |
| `approveAusencia` | `/aprobaciones`, `/solicitud-ausencia`, `/calendario` | `/aprobaciones` | sin revalidate |
| `rejectAusencia` | `/aprobaciones`, `/solicitud-ausencia` | `/aprobaciones` | sin revalidate |
| `approvePasaje` | `/aprobaciones`, `/solicitud-pasaje`, `/calendario` | `/aprobaciones` | sin revalidate |
| `rejectPasaje` | `/aprobaciones`, `/solicitud-pasaje` | `/aprobaciones` | sin revalidate |

(El error genérico no cambió nada en la base: no hay número que refrescar.)

Otros puntos donde una solicitud **entra o sale** de `pendiente`:

| Punto | Transición | Revalida |
|---|---|---|
| `solicitud-ausencia/actions.ts::createAusenciaRequest` (no-admin) | → `pendiente` | `/solicitud-ausencia` |
| `solicitud-pasaje/actions.ts::createPasajeRequest` (no-admin) | → `pendiente` | `/solicitud-pasaje` |
| `mi-perfil/actions.ts::handleDocumentUpload` | → `pendiente` | `/mi-perfil` |
| `createAusenciaRequest` / `createPasajeRequest` (admin-para-sí, RPC `crear_aprobar_*`) | nunca pasa por `pendiente` | `/solicitud-*`, `/aprobaciones`, `/calendario` |
| `uploadDocumentForEmployee` (A5) | nunca pasa por `pendiente` | `/admin/empleado/[id]` |
| `aprobadas/actions.ts` (cancelar/editar post-aprobación) | `aprobado` → … (no toca `pendiente`) | — |

### 2.1 Comportamiento real de la revalidación en Next 15.5.19 (verificado en el código de Next)

**Pregunta del prompt (Paso 4):** el badge vive en el layout; ¿`revalidatePath('/aprobaciones')` recalcula el layout?

**Respuesta: sí, dentro de la misma respuesta de la Server Action.** Cadena verificada:

1. `client/components/router-reducer/reducers/server-action-reducer.js`: el `fetch` de una action manda `Next-Action` y `Next-Router-State-Tree`, pero **no** el header `RSC`.
2. `server/app-render/app-render.js` (`parseRequestHeaders`): `shouldProvideFlightRouterState = isRSCRequest && …` → para una action, `flightRouterState = undefined`.
3. `server/app-render/action-handler.js`: si la action llamó a `revalidatePath` (cualquier path), `skipFlight: !workStore.pathWasRevalidated` → se genera flight.
4. `server/app-render/walk-tree-with-flight-router-state.js`: `renderComponentsOnThisLevel = !flightRouterState || …` → sin router state, **se renderiza desde la raíz, layouts incluidos**.

Conclusión: toda action de resolución que ya llama `revalidatePath(...)` devuelve el árbol completo re-renderizado, incluido `app/(app)/layout.tsx` → el contador se recalcula en ese mismo round-trip. Además, `revalidatePath` purga el Router Cache del cliente. **No hace falta cambiar la revalidación de las actions de Aprobaciones**; se fija con un e2e (aprobar → el badge baja).

### 2.2 Límite encontrado: navegación suave **no** recalcula el layout

En una navegación con `<Link>` entre rutas hermanas de `(app)`, el cliente sí manda `RSC: 1` + router state; el segmento del layout coincide → `renderComponentsOnThisLevel = false` → **el layout compartido no se re-renderiza**, solo la página (por eso hoy el título de la topbar se resuelve en el cliente con `useSelectedLayoutSegment`).

Efecto: si **otra sesión** cambia el número (un empleado envía una solicitud, otro admin resuelve) mientras el admin navega sin recargar, el badge queda con el valor del último render completo del layout (carga/recarga, o la última action del admin que revalidó). Puede verse, por ejemplo, un badge "3" sobre una bandeja que ya lista 4 filas hasta recargar.

Esto choca con la letra de la decisión "Actualización: al cargar/navegar" combinada con "calcular en el server component del layout". **No se implementa un workaround en este PR** (el alcance es cerrado y cualquier opción agrega comportamiento no pedido): se reporta para decisión. Opciones, de menor a mayor costo:

- **(a)** Aceptarlo: el número es exacto al cargar/recargar y después de cada acción del admin.
- **(b)** Sincronizar solo en `/aprobaciones`: la página ya tiene el conteo real (`items.length`); un componente cliente chico compara con el valor del layout y hace `router.refresh()` una sola vez si difieren.
- **(c)** `router.refresh()` en cada cambio de ruta para admin: siempre fresco, pero duplica el render server-side (y las queries) de cada navegación del admin.

## 3. `components/layout/Topbar.tsx`

- **Client Component** (`'use client'`; usa `useSelectedLayoutSegment` para título/ícono).
- Props: `onMenuToggle: () => void`, `userName: string`.
- Campanita: `<button className="relative p-2 rounded-lg text-neutral hover:bg-surface transition-colors" aria-label={copy.topbar.notifications}>` con `<Bell size={18} />` y un comentario `{/* Badge — futuro: conectar a conteo real */}`. **Sin `onClick`, sin navegación, sin badge.** Ya tiene `relative`, listo para un badge absoluto.
- Nada en el botón impide reemplazarlo por un `<Link>` de Next.

## 4. `components/layout/AppShell.tsx` y `app/(app)/layout.tsx`

- `app/(app)/layout.tsx`: **Server Component** async. `const profile = await requireAuth();` (`lib/auth.ts`: `createServerClient()` → `auth.getUser()` → `profiles` por id → gate `status === 'activo'`). Deriva `userName = profile.full_name || profile.email || copy.auth.login.welcome` y renderiza `<AppShell role={profile.role} userName={userName}>`.
- `AppShell`: **Client Component** (estado `sidebarOpen`). Props `role`, `userName`, `children`; pasa `role` a `Sidebar` y `userName` a `Topbar`.
- La sesión se resuelve una sola vez en el layout; `role` y `userName` bajan por props. Es el lugar natural para calcular el conteo (server) y bajarlo por la misma vía.

## 5. `lib/copy/index.ts` — claves bajo `topbar`

```ts
topbar: {
  notifications: 'Notificaciones',
  userMenu:      'Menú de usuario',
  menuButton:    'Menú',
},
```

## 6. Otros hallazgos relevantes

- **Clientes Supabase:** la bandeja usa `createServerClient()` (RLS). `aprobaciones/actions.ts` usa `createAdminClient()` para *escribir* documentos — no aplica a esta lectura. El helper usa `createServerClient()` (§6.1).
- **Tests de la página** (`tests/unit/aprobaciones-page-*.test.ts`) mockean `from(table)` con builders `select → eq → order`. Extraer las queries a un helper que conserve esa cadena no los rompe.
- **Tokens de color:** `tailwind.config` define `error` (`#C62828`) y `primary`. El badge usa clases literales (`bg-error`, `text-white`, …).
- **e2e:** `workers: 1` en CI (serial), `fullyParallel` local. Los datos pendientes de otras specs pueden coexistir: el e2e del contador calcula el esperado contra la base efímera en vez de asumir un número fijo.
- **Migración:** no hace falta ninguna. Todo es lectura de columnas existentes (`estado`) con la RLS vigente.

## 7. Plan derivado

1. `lib/aprobaciones.ts`: una única definición del filtro de la bandeja (`pendientesQuery(supabase, tabla, select, options?)` → `.from(tabla).select(...).eq('estado','pendiente')`) consumida por la página (con `select` + `order`) y por `contarAprobacionesPendientes(supabase)` (con `{ count: 'exact', head: true }`). Errores leídos como valor; ante fallo, `console.error` y devolver `null` (sin badge, layout intacto).
2. `app/(app)/layout.tsx`: conteo solo si `profile.role === 'admin'`; prop `aprobacionesPendientes` → `AppShell` → `Topbar`.
3. `Topbar`: la campanita pasa a ser `<Link href="/aprobaciones">` **solo para admin** (supervisor/empleado no tienen acceso a `/aprobaciones`; su campanita queda como hoy); badge solo si `> 0`, `99+` por encima de 99, clases literales, `aria-label` con cantidad desde `/lib/copy`.
4. Revalidación: sin cambios en actions (ver §2.1); verificado por e2e. Límite de navegación (§2.2) reportado.
5. Tests: unit del helper, coincidencia helper ↔ filas de la bandeja, límite de rol (3 roles) en layout y topbar, e2e (badge correcto → click → `/aprobaciones`; aprobar baja el número; cero → sin badge; supervisor/empleado sin badge).
