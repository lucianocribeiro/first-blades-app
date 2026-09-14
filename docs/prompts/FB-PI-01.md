# FB-PI-01 — Campanita: contador de aprobaciones pendientes (admin)

- **ID:** FB-PI-01
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-01.md`
- **Origen:** Log de Airtable, registro `recgOXgfWkzEID5zV` (Mejora, prioridad Alta, módulo Notificaciones)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna. Si la inspección sugiere que hace falta una, **frená y reportá** antes de escribir SQL.

---

## Contexto

La campanita del admin existe en la topbar pero no está cableada: no muestra nada y no lleva a ningún lado. Esto es una **función faltante**, no un bug. El skill `design-system` ya la especifica con badge de conteo, así que no hay decisión de diseño nueva que tomar.

El alcance es **mínimo y cerrado**: contador de aprobaciones pendientes + navegación a la bandeja. **No** es un centro de notificaciones general (vencimientos de documentos, alertas de franco, rechazos). Si durante el trabajo aparece la tentación de generalizarlo, no lo hagas: eso sería otra entrada del Log.

Principio que aplica (constitución §2.4): la app es la fuente de verdad consultable. Esto es **solo lectura** de un estado que ya existe en la base.

---

## Decisiones ya tomadas (no re-abrir)

| Decisión | Valor |
|---|---|
| Alcance del conteo | Solicitudes en `estado = 'pendiente'` de **pasajes + ausencias + documentos**. **No hay onboarding**: el módulo "Ingreso" se descartó entero en `FB-ADJ-03` (constitución §4/§7/§8). |
| Visibilidad | **Solo admin.** Supervisor y empleado no ven contador. |
| Actualización | **Al cargar/navegar** (render server-side). **Sin** suscripción realtime. |
| Conteo en cero | **Sin badge.** La campanita queda limpia, como hoy. No mostrar un "0". |
| Click | Navega a **Aprobaciones** (`/aprobaciones`). |

---

## Paso 0 — Inspección (obligatorio, con informe versionado)

**No escribas código hasta terminar este paso.** Constitución §1.1: todo prompt que arranca con una inspección debe producir su informe versionado explícito; no alcanza con dejar el relevamiento en el chat.

Relevá y documentá:

1. **`app/(app)/aprobaciones/page.tsx`** — el query exacto con el que la bandeja arma su lista hoy. Qué tablas consulta, con qué filtros, y si hay **scope de negocio superpuesto a la RLS**.
   > ⚠️ **Riesgo principal de este item.** La constitución §5 documenta que la cola de aprobación de ausencias filtra por **motivo + estado**, no solo por estado, y que la action revalida ese scope server-side. Si la bandeja filtra por algo más que `estado = 'pendiente'`, el contador tiene que filtrar **exactamente igual** o el número no va a coincidir con las filas visibles — y ese es el criterio de aceptación principal.
2. **`app/(app)/aprobaciones/actions.ts`** — qué `revalidatePath()` se dispara al aprobar y al rechazar.
3. **`components/layout/Topbar.tsx`** — estado actual del botón de la campanita, qué props recibe el componente, si es cliente o servidor.
4. **`components/layout/AppShell.tsx`** y **`app/(app)/layout.tsx`** — cómo bajan `role` y `userName`, dónde se resuelve la sesión, qué helper de auth se usa.
5. **`lib/copy/index.ts`** — claves existentes bajo `topbar`.

**Entregable del paso 0:** `docs/audits/FB-PI-01-INSPECT.md`, versionado y commiteado, con el query real de la bandeja transcripto. Sobre ese archivo se construye el resto.

---

## Paso 1 — Helper único de conteo (SSOT)

Extraé una función única que sea la **fuente de verdad del número**, y hacé que **la bandeja y el badge consuman la misma función**. Que el contador y la lista se calculen por caminos separados es exactamente cómo se desincronizan.

- Ubicación sugerida: `lib/aprobaciones.ts` (o donde la inspección indique que es natural; justificá si elegís otra).
- Firma orientativa: `contarAprobacionesPendientes(supabase): Promise<number>`.
- **Cliente:** `createServerClient()`. **Nunca** `createAdminClient()` — el service-role saltea RLS y no corresponde para una lectura de feature (constitución §6.1).
- Conteo eficiente: `select('*', { count: 'exact', head: true })` por tabla. No traigas filas para contarlas.
- **Errores de PostgREST se leen como valor, no los captura un `try/catch`** (constitución §2.5). Leé el `{ error }` de cada query explícitamente.
- **Degradación suave:** si alguna query falla, `console.error` y devolvé un conteo que **no rompa el render del layout**. La campanita sin badge es un resultado aceptable ante un fallo de lectura; una topbar caída no lo es.
- Si la inspección muestra que la bandeja aplica filtros de negocio adicionales, el helper los replica y eso queda **documentado con un comentario** que apunte al invariante.

---

## Paso 2 — Cablear el número hasta la campanita

- Calculá el conteo en el **server component** del layout de la app, no en el cliente.
- Calculalo **solo si el rol es `admin`**. Para supervisor y empleado no se consulta nada y no se pasa número.
- Bajá el valor por props: layout → `AppShell` → `Topbar`. Prop nullable (ej. `aprobacionesPendientes?: number`); ausente = no hay badge.
- La RLS sigue siendo el control real de permisos; ocultar en la UI es complementario, nunca el único control (constitución §12.1).

---

## Paso 3 — Badge y navegación

- **Badge** sobre la campanita solo si el número es `> 0`. Con 0, o sin número, **no se renderiza el badge**.
- Cap de display: mostrar el número exacto hasta 99; `99+` de ahí en adelante.
- **La campanita navega a `/aprobaciones`** al hacer click. Usá `Link` de Next, no un handler con `router.push`, salvo que la estructura del botón lo impida (si lo impide, explicá por qué).
- ⚠️ **Clases de Tailwind literales, sin composición en runtime.** El bug del franco (`recO3SGuYGiB2qEJ3`, PR #49) fue exactamente esto: una clase compuesta dinámicamente que el JIT nunca emitió al CSS, y la celda quedó transparente. Toda clase del badge va escrita entera como literal.
- Accesibilidad: `aria-label` en es-AR desde `/lib/copy`, que incluya la cantidad. Sin strings hardcodeados.

---

## Paso 4 — Revalidación (no te lo saltees)

El badge vive en el **layout**, no en la página de Aprobaciones. Un `revalidatePath('/aprobaciones')` común revalida la página, y el número del badge **puede quedar viejo después de aprobar o rechazar**: el admin resuelve una solicitud, la fila desaparece de la tabla y el globito sigue marcando el número anterior.

Verificá el comportamiento real y, si hace falta, extendé la revalidación en `aprobaciones/actions.ts` para que el layout también se recalcule. Documentá qué encontraste y qué cambiaste.

Lo mismo aplica a cualquier otro punto del código donde una solicitud pase a `pendiente` o salga de `pendiente`.

---

## Paso 5 — Copy

Claves nuevas en `/lib/copy`, bajo `topbar`. Todo en es-AR, sin strings sueltos en componentes.

---

## Paso 6 — Tests

- **Unit del helper:** suma las tres fuentes; ignora `aprobado` y `rechazado`; devuelve 0 cuando no hay nada; respeta los filtros de negocio que tenga la bandeja.
- **Test de coincidencia (criterio principal):** el número que devuelve el helper es igual a la cantidad de filas que lista la bandeja, sobre el mismo set de datos.
- **Test de límite de rol para los 3 roles** (constitución §13): admin ve contador; supervisor y empleado no.
- **e2e Playwright:** admin logueado ve el badge con el número correcto → click → aterriza en `/aprobaciones`. Y el caso de cero pendientes: no hay badge. **No rompas la suite existente** — corre como tercer job de CI.
- Afirmá el **resultado visible** (que el badge existe/no existe, que el texto es el número), no la clase CSS como string. El bug del franco se escapó justamente porque un test afirmaba el string en vez del efecto.

---

## Fuera de alcance (no tocar)

- Centro de notificaciones general: vencimientos de documentos, alertas de franco, avisos de rechazo al empleado. Nada de eso entra acá.
- Realtime / suscripciones.
- Cualquier cambio a la lógica de aprobación, a las RPCs `SECURITY DEFINER` o al patrón purgatorio.
- Rediseño de la topbar más allá del badge.
- Migraciones y `db push`.
- El bug de `audit_log` tragado en `aprobaciones/actions.ts` (Log `recgttytHv9848xI8`) — está en el mismo archivo, es tentador, **no lo arregles acá**. Es otra entrada del Log.

---

## Definición de Done

Skill `dod-checklist` completa, más:

- [ ] `docs/audits/FB-PI-01-INSPECT.md` commiteado con el query real de la bandeja.
- [ ] El badge del admin muestra el número correcto y coincide con las filas de la bandeja.
- [ ] Click en la campanita lleva a Aprobaciones.
- [ ] Admin-only, verificado por test para los 3 roles.
- [ ] Con cero pendientes no hay badge.
- [ ] El número se actualiza después de aprobar/rechazar (revalidación del layout resuelta).
- [ ] Copy 100 % es-AR desde `/lib/copy`.
- [ ] CI verde: typecheck, lint, tests, build, integración RLS, e2e Playwright.
- [ ] Sin migración. Si apareciera la necesidad de una, se frena y se reporta.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-01.md`.

**El merge lo autoriza Luciano, sin excepción** (constitución §1.1). No mergees por tu cuenta. Antes de pedir autorización, entregá el estado real del repo: branch, PR abierto con estado de CI por job, commits fuera de main.
