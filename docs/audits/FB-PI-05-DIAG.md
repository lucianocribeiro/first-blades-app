# FB-PI-05-DIAG — Diagnóstico: truncamiento silencioso a 1000 filas (tope PostgREST)

> **¿Está truncando hoy en producción? NO.** La tabla más grande, `rotation_assignments`, tiene **69 filas en total** y ninguna consulta de la app puede devolver hoy más de 69 filas de ella.
>
> **⚠️ Pero la carga del historial de 3 meses lo dispararía en el acto.** La consulta que se rompe primero **no es la grilla del roster: son las alertas de franco** (pantalla de Calendario **y** cron de mails), que leen una ventana de 66 días. Con los 25 empleados activos y el historial cargado son ~1650 filas: se truncaría desde el primer día. **El historial no se debe importar antes de este fix.**

- **Fecha:** 2026-10-06
- **Rama:** `fix/fb-pi-05-truncamiento-postgrest` (desde `main` @ `7c23982`)
- **Prompt:** `docs/prompts/FB-PI-05.md` (Paso 0)
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** lectura del código (todas las llamadas `.from(…)` de `app/` y `lib/`, con su cadena completa) + **una sola consulta de solo lectura a producción** (proyecto `simfemdkrkdbumefcxei`) que devuelve **conteos agregados**, sin filas ni datos personales. Sin escrituras.

---

## 0. Datos de producción (2026-10-06, hora AR)

| Medida | Valor |
|---|---|
| `profiles` total / activos / **activos no-admin** (scope del roster del admin) | 28 / 27 / **25** |
| `rotation_assignments` total | **69** |
| Máximo de filas en un mismo mes (empleados activos) | 18 |
| Filas en la ventana de alertas de franco (hoy−65 → hoy) | 18 |
| Días de trámite del año en curso | 0 |
| `notification_log` total | 0 |
| `documents` total / aprobados con vencimiento | 4 / 3 |
| `audit_log` | 19 |
| `ausencia_requests` aprobadas / `pasaje_requests` aprobados | 2 / 0 |
| `procedures` | 1 |
| Filas pasadas todavía con `es_estimado = true` | 19 (confirma el hallazgo §7 del PRD de export/import: el cron de promoción no las consolidó; fuera de alcance acá) |

Tope vigente: `max_rows = 1000` (`supabase/config.toml`; también el default de Supabase hosted).

---

## 1. La forma real de la consulta del roster

`app/(app)/calendario/page.tsx`:

```ts
const days = getDaysInMonth(year, month);           // 28–31 fechas, el mes calendario
const firstDay = days[0];
const lastDay = days[days.length - 1];
…
supabase.from('rotation_assignments').select('*')
  .in('user_id', employeeIds).gte('fecha', firstDay).lte('fecha', lastDay)
```

- **Pide exactamente los días del mes** (28, 29, 30 o 31). `getDaysInMonth` (`calendario/utils.ts`) arma la lista del 1 al último día del mes.
- **La grilla NO dibuja semanas completas (42 celdas).** `RosterGrid` recorre `days.map(...)` tal cual le llega: una columna por día del mes, sin relleno de semanas. Verificado en `RosterGrid.tsx:107` y `:127`.
- La consulta **no tiene `.order()` ni `.range()`**: si truncara, el subconjunto que queda afuera sería arbitrario.

## 2. ¿Filtra por `status = 'activo'`?

**Sí, indirectamente.** La consulta de `rotation_assignments` va acotada por `.in('user_id', employeeIds)`, y `employeeIds` sale de:

```ts
supabase.from('profiles').select('id, full_name, email').eq('status', 'activo')
  .in('role', ['empleado', 'supervisor'])        // scope admin
```

Para el admin: **activos y no-admin = 25** (no 27 ni 28; los 2 admins activos no están en la grilla). Supervisor y empleado ven menos (su equipo o solo lo propio).

## 3. ¿Prefetch de meses adyacentes o lecturas que amplíen el rango?

**No.** Cada render de `/calendario` consulta **un solo mes** (`?year=&month=`). `MonthNav` usa `<Link>`; si Next prefetchea el mes adyacente, eso es **otro render con su propia consulta de un mes**, no amplía el rango de ninguna consulta.

**Sí hay otras dos lecturas en la misma página** con rango propio, independientes del mes visible:

| Lectura (page.tsx) | Rango | Filas máximas |
|---|---|---|
| Alertas de franco (`:162`) | **hoy−65 → hoy (66 días)** | 25 × 66 = **1650** |
| Saldo de días de trámite (`:193`) | año calendario, solo `motivo_ausencia = 'dia_tramite'` | ~3 por empleado por año (tope de política) |

## 4. Umbrales exactos (sobre las consultas reales)

Filas devueltas = empleados en scope × días con asignación en el rango. El peor caso es el calendario **completamente cargado**.

| Consulta | Fórmula | Trunca a partir de… (calendario lleno) |
|---|---|---|
| Roster, mes de 31 días | N × 31 | **N ≥ 33** activos no-admin (32 × 31 = 992 ✓; 33 × 31 = 1023 ✗) |
| Roster, mes de 30 días | N × 30 | N ≥ 34 |
| Roster, febrero (28) | N × 28 | N ≥ 36 |
| **Alertas de franco (66 días)** — página **y** cron | N × 66 | **N ≥ 16** |

Hoy N = 25:

- **Roster:** 25 × 31 = 775. **No puede truncar**, ni siquiera con el mes completamente cargado. Margen: 8 altas.
- **Alertas de franco:** 25 × 66 = 1650. **Trunca en cuanto haya más de 1000 asignaciones en la ventana**, es decir, unos 40 días seguidos con el calendario completo para los 25. **El historial de 3 meses lo garantiza.**

## 5. ¿Está truncando hoy? — **NO**

Fundamento: el máximo que **cualquier** consulta de `rotation_assignments` puede devolver hoy es el total de la tabla, **69 filas**. Para el resto de las tablas, la más grande tiene 19 filas (`audit_log`), que la app no lista. **Ninguna respuesta de hoy llega a 1000.**

Además, **el roster no puede truncar con la nómina actual** sin importar cuántos datos se carguen (775 < 1000). Lo que sí está por romperse con la carga del historial son las **alertas de franco**, en la pantalla y en el **cron de mails** (`lib/notifications/franco-alerts-store.ts:103`, la misma consulta de 66 días). El efecto: la racha de días trabajados o de franco se calcula sobre un subconjunto arbitrario de días, así que salen **alertas falsas o se pierden alertas reales, y se mandan por mail**.

---

## 6. Barrido de toda la app

Se recorrieron **todas** las llamadas `.from(<tabla>)` de `app/` y `lib/` (79). Se descartaron:

- las escrituras (`insert`/`update`/`upsert`/`delete`);
- las lecturas de una fila (`.single()`/`.maybeSingle()`);
- los conteos con `{ count: 'exact', head: true }` (el conteo lo calcula Postgres, no hay filas que truncar).

Las RPC (`.rpc(...)`) son todas escrituras; **ninguna función devuelve `SETOF`/`TABLE`**.

Quedan **38 lecturas de listas** (37 directas + la de idempotencia de franco, que pasa por `francoNotificationLog(client)`). Clasificación:

### 6.1 🔴 Riesgo real: tabla que crece con nómina × tiempo, sin paginar

| # | Consulta | Filas máximas | Se rompe cuando… | Efecto silencioso |
|---|---|---|---|---|
| A | **Alertas de franco — página** `calendario/page.tsx:162` | N × 66 | ≥ 1001 asignaciones en 66 días (**con el historial cargado: ya**) | Alertas de descanso falsas o faltantes en Calendario |
| B | **Alertas de franco — cron** `lib/notifications/franco-alerts-store.ts:103` | N × 66 | ídem | **Mails** de alerta falsos o faltantes |
| C | **Roster del mes** `calendario/page.tsx:135` | N × 31 | N ≥ 33 activos con el mes lleno | Celdas con asignación que se ven vacías; el admin puede pintar encima |
| D | **Idempotencia de alertas de franco** `franco-alerts-store.ts:115` (`notification_log`, **sin filtro de fecha**) | crece para siempre: episodios × umbrales × destinatarios | > 1000 alertas enviadas históricas a empleados activos (meses/años) | Un aviso ya enviado no aparece como enviado → **mail duplicado** en cada corrida |
| E | **Idempotencia de vencimientos** `lib/notifications/document-expiry-store.ts:55` (`notification_log` por `document_id`) | docs con vencimiento × 3 umbrales × destinatarios | ~100+ documentos que pasaron por los 3 umbrales | **Mails de vencimiento duplicados** en cada corrida |

### 6.2 🟠 Riesgo medio: crece con el tiempo, es un listado de la UI

| # | Consulta | Se rompe cuando… | Efecto |
|---|---|---|---|
| F | **Aprobadas** `aprobadas/page.tsx:32` (todas las ausencias aprobadas, todo el historial) | > 1000 ausencias aprobadas | Las más viejas desaparecen del listado sin aviso |
| G | **Aprobadas** `aprobadas/page.tsx:37` (todos los pasajes aprobados) | > 1000 pasajes aprobados | ídem |
| H | **Equipo** `equipo/page.tsx:29` (documentos aprobados con vencimiento, todos los empleados) | > 1000 documentos con vencimiento | Faltan alertas de vencimiento en Equipo |
| I | **Cron de vencimientos** `document-expiry-store.ts:23` (misma lectura que H) | ídem | Documentos que vencen **sin mail** |

F y G son listados que, a esa escala, van a necesitar **paginación en la UI** (cambio de arquitectura). Ver §7.

### 6.3 🟢 Acotadas: no llegan a 1000 en ningún escenario razonable

| Consulta | Por qué está acotada |
|---|---|
| Saldo de días de trámite: `calendario/page.tsx:193`, `aprobaciones/page.tsx:87`, `solicitud-ausencia/page.tsx:49` | Solo `dia_tramite` de un año: el tope de política es 3 por empleado. Harían falta más de 300 empleados excediéndolo |
| Superposición por solicitud: `aprobaciones/page.tsx:130`, `:154`, `aprobadas/actions.ts:384`, `:419` | Un empleado × el rango de una solicitud (días). Haría falta una solicitud de más de 1000 días |
| Documentos de un usuario: `mi-perfil/page.tsx:21`, `admin/empleado/[id]/page.tsx:38` | Decenas de documentos por persona (hoy el máximo es 2) |
| `mi-perfil/actions.ts:141` | `.in('storage_path', paths)` con los paths de la página (decenas) |
| `mi-perfil/actions.ts:186` | ya tiene `.limit(10)` |
| Perfiles: `equipo/page.tsx:27`, `gestion-usuarios/page.tsx:16`, `calendario/page.tsx:104`, `mi-equipo/page.tsx:25`, `solicitud-pasaje/page.tsx:31`, `franco-alerts-store.ts:79`/`:89`, `document-expiry-store.ts:35`/`:45` | Haría falta pasar los 1000 perfiles (hoy hay 28) |
| Solicitudes propias: `solicitud-ausencia/page.tsx:27`, `solicitud-pasaje/page.tsx:60` | Las de una persona (o un supervisor y su equipo) |
| Bandeja de Aprobaciones `lib/aprobaciones.ts:35` | Solo las **pendientes**; en régimen son pocas |
| `procedures` (`procedimientos/*`) | Decenas |

### 6.4 ⚪ Truncamiento benigno o solo informativo

| Consulta | Comportamiento |
|---|---|
| `lib/purge.ts:58` (documentos rechazados a purgar) | Es un lote de cron: lo que quede afuera se procesa en la corrida siguiente. Se autocorrige, aunque en silencio |
| `lib/rotation/promote-estimated.ts:41` (`update … .select('id')`) | El `UPDATE` afecta todas las filas; como mucho, el **conteo** que se reporta podría quedar recortado. No afecta datos |
| `audit_log` | La app **no lo lista** en ningún lado (solo inserta). No aplica |

### 6.5 Nota lateral, no es truncamiento: tamaño del URL en `.in()`

Varias consultas mandan listas de UUID por query string (`.in('user_id', ids)`, `.in('document_id', docIds)`). Con muchos cientos de IDs, el URL puede superar el límite del gateway antes que el tope de filas, y en ese caso falla **con error** (no en silencio). Hoy son 25 IDs. No se toca en este PR; queda reportado.

---

## 7. Propuesta de alcance para el fix (Pasos 1–2)

**Entra en este PR** (truncamiento silencioso de riesgo equivalente; solo cambia la **lectura**, no la UI):

- **A, B, C:** calendario (roster, alertas de franco en página y cron).
- **D, E:** idempotencia de `notification_log`. Truncarla manda **mails duplicados**, que es el mismo tipo de daño silencioso.
- **H, I:** documentos con vencimiento (Equipo + cron).
- El **export de FB-PI-04** pasa a consumir el helper (ver §8).

**No entra; va a items propios del Log:**

- **F, G (Aprobadas):** leer todo con el helper evitaría el truncamiento, pero un listado de miles de filas sin paginar en la UI es un problema de arquitectura (rendimiento, usabilidad). Propuesta: item "Aprobadas: paginación en la UI". Si Luciano prefiere cubrir ya la corrección de datos, aplicarles el helper es trivial y se puede sumar acá.
- **§6.5 (URL de `.in()`):** item aparte.
- **19 filas pasadas con `es_estimado = true`:** ya registrado en el PRD de export/import (§7), va a `rec2CQcbv5jKODcAF` o a un item de cron.

## 8. Coordinación con FB-PI-04

`feat/fb-pi-04-export-calendario` (2 commits locales, sin pushear) **ya tiene su propia paginación** en `lib/rotation/calendario-export.ts::fetchCalendarioExportData`. **Va a haber conflicto lógico y uno textual menor:**

- **Lógico:** si FB-PI-05 crea el helper desde `main` y FB-PI-04 queda con su loop propio, quedan **dos implementaciones**, que es lo que el prompt pide evitar.
- **Textual:** los dos branches tocan `lib/copy/index.ts` (FB-PI-04 suma `calendario.excel`; FB-PI-05 sumará los mensajes de error del helper) y posiblemente `app/(app)/calendario/page.tsx` (FB-PI-04 agrega el panel; FB-PI-05 cambia las lecturas). Son zonas distintas del archivo y probablemente se mergeen solas, pero no está garantizado.

**Orden de merge propuesto (decide Luciano):**

1. **FB-PI-05 primero** (es el blocker y sale de `main`).
2. Rebase de FB-PI-04 sobre el nuevo `main`, **reemplazando su loop por el helper** (un commit chico en FB-PI-04), y después su merge.

La alternativa (FB-PI-04 primero y extraer su loop acá) demora el blocker atrás de un PR que todavía no pasó por CI. No se resuelve nada de esto por cuenta propia.
