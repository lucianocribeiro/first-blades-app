# FB-F3-FIX-01 — Fix: celdas estimadas invisibles en el calendario (clase Tailwind inexistente)

- **Fase:** 3 (fix sobre módulo ya cerrado)
- **Tipo:** fix de lógica/UI de render
- **Destino en el repo:** `docs/prompts/FB-F3-FIX-01.md`
- **Rama:** `fix/fb-f3-fix-01-celdas-estimadas`
- **Constitución de referencia:** `docs/constitucion.md` v0.7.1
- **Migración de base de datos:** NO. Sin `db push`.
- **Bug en el Log:** `recO3SGuYGiB2qEJ3` (Calendario, Alta)
- **Diagnóstico previo:** FB-F3-FIX-DIAG-01
- **Auditoría que sigue:** `FB-F3-FIX-AUD-01`

---

## Objetivo

Corregir el render de las celdas **estimadas** del calendario. Hoy la clase de fondo se **compone en runtime** (`${base}/35`) y Tailwind v3 (JIT) solo emite clases que ve como **string literal** al escanear; `bg-calendar-enFranco/35`, `bg-calendar-enViaje/35` y `bg-calendar-fueraTrabajo/35` **no se generan**, así que esas celdas quedan transparentes (blancas). El fix debe hacer que **toda celda estimada, de cualquier estado, renderice con una clase que exista en el CSS compilado.**

## Contexto (del diagnóstico)

- **Ubicación:** `app/(app)/calendario/utils.ts:78`, función `getCellVisual()`:
  `const bgClass = assignment.es_estimado ? \`${base}/35\` : base;`
- La única `/35` que existe es `bg-calendar-trabajando/35`, por accidente (aparece literal en `Legend.tsx:26`). Las otras tres no existen en ningún lado. No hay safelist en `tailwind.config.ts`.
- **No es tope de 4 ni falla de escritura.** La fila del día 5 existe con estado correcto; solo es invisible. "El 5º" = primer día **futuro** del rango (`es_estimado = fecha > hoy`); el rango arrancó antes de hoy. Una celda realmente sin asignar es **gris** (`bg-calendar-vacio`, clase que sí existe); lo reportado era **blanco**, consistente con clase inexistente.
- **Alcance real:** todo día estimado que no sea `trabajando` es invisible en toda la grilla, para los 3 roles, en las vistas de solo lectura y en los estimados del modal de celda única. No es solo el pintado por rango ni solo franco.

## Alcance del fix

1. **Dejar de componer la clase en runtime.** Definir un **mapa de strings literales completos** como única fuente de verdad (SSOT) con la variante estimada por estado, de modo que el scanner de Tailwind vea cada clase como literal y la emita. Ej.:
   ```
   ESTADO_BG_CLASS_ESTIMADO = {
     trabajando:   'bg-calendar-trabajando/35',
     enFranco:     'bg-calendar-enFranco/35',
     enViaje:      'bg-calendar-enViaje/35',
     fueraTrabajo: 'bg-calendar-fueraTrabajo/35',
   }
   ```
   `getCellVisual()` elige del mapa real o del estimado según `es_estimado`, sin construir el nombre con template literal.
2. **Preservar la intención visual:** estimado = versión translúcida (/35) del color del estado, distinguible del real; `vacio` sigue gris (`#CBD5E1`).
3. **Fix general, no parche de franco:** vive en el helper compartido `getCellVisual()`, así que arregla de una el pintado por rango, el modal de celda única y las vistas de lectura de los 3 roles. No parchear solo `en_franco`.
4. **Barrido defensivo:** buscar en el módulo de calendario otras clases Tailwind compuestas en runtime (template literals que armen nombres de clase) por si el mismo anti-patrón muerde en otro lado. Reportar hallazgos.

> Alternativa aceptable: safelist explícito en `tailwind.config.ts`. Pero el mapa literal SSOT es más robusto y no depende de config; **preferirlo**.

## Cerrar el hueco de tests (obligatorio)

El test viejo (`tests/unit/calendario-utils.test.ts:131`) afirmaba el **string** (`toBe('bg-calendar-enFranco/35')`), no que la clase **exista** en el CSS compilado — por eso pasó en verde con el bug vivo. El fix tiene que cerrar ese hueco, no solo cambiar la línea 78:

- **Unit:** matriz completa (cada estado × `es_estimado` true/false) → la clase literal esperada, tomada del **mismo mapa SSOT** (un solo lugar define las clases; el test verifica contra ese lugar).
- **e2e (Playwright, ya en la compuerta de CI):** renderizar una celda estimada que no sea `trabajando` (ej. `en_franco` estimado) y **assertar que el fondo está efectivamente pintado** (computed style ≠ transparente / color esperado). Este es el guard que agarra "la clase no existe en el CSS compilado" — el hueco exacto que dejó pasar el bug. No romper el job e2e existente.
- **Regresión (del pedido original):** pintar por rango un franco de **6 días todos futuros** (todos estimados) → los 6 quedan visiblemente `en_franco`, ninguno transparente. **Borde:** rango que cruza días ya asignados (idempotencia del upsert) sigue verde.

## Gobernanza (v0.7.1)

- Solo lógica/UI + tests + (si se usa safelist) config de Tailwind. **Sin migración, sin `db push`.**
- CI **verde**, incluido el job **e2e Playwright**. Codex audita el diff antes del merge (`FB-F3-FIX-AUD-01`).

## Skills a reutilizar

- **`design-system`** (tokens/colores del calendario), **`dod-checklist`**.

## Definition of Done

- `getCellVisual()` (y cualquier composición equivalente) usa clases **literales de un mapa SSOT**; toda celda estimada de todo estado renderiza con una clase que existe en el CSS.
- Barrido defensivo reportado (otras composiciones runtime, si las hay).
- Unit de matriz completa + **e2e que prueba el fondo pintado** + regresión de 6 días de franco futuros + borde de idempotencia.
- CI verde (incluido e2e).
- **Versionar el propio `.md`** en `docs/prompts/FB-F3-FIX-01.md`.
- Cerrar con `dod-checklist`.
- Al terminar: `git status`. Sigue `FB-F3-FIX-AUD-01`.

---

# Resultado de la implementación

## Archivos tocados

| Archivo | Cambio |
|---|---|
| `app/(app)/calendario/utils.ts` | SSOT: `ESTADO_BG_CLASS` (ya existía, ahora exportado), `ESTADO_BG_CLASS_ESTIMADO` (nuevo, literales completos), `CELDA_VACIA_BG_CLASS` (nuevo). `getCellVisual()` elige de un mapa; ya no compone con template literal. |
| `app/(app)/calendario/Legend.tsx` | Deja de repetir el mapeo estado→clase: consume el SSOT. Elimina el literal accidental que mantenía viva una sola variante. |
| `tests/unit/calendario-utils.test.ts` | Matriz completa 4 estados × `es_estimado` true/false contra el SSOT + anclaje explícito de los literales. |
| `tests/unit/calendario-clases-tailwind.test.ts` | **Nuevo.** Guard: compila Tailwind con la config real y afirma que cada clase del SSOT se emite al CSS pintando `background-color`. |
| `tests/e2e/calendario-celda-estimada.spec.ts` | **Nuevo.** Celda planificada con fondo computado ≠ transparente; regresión de 6 días de franco futuros; borde de idempotencia. |
| `tests/e2e/helpers.ts` | `seedRotationAssignment` acepta `esEstimado`/`motivoAusencia` y cualquier `EstadoDia` (default sin cambios); nuevo `clearRotationAssignments`. |

## Barrido defensivo

`app/(app)/calendario/utils.ts:78` era **la única** composición de nombre de clase Tailwind en runtime de todo el repo (barrido sobre `app/`, `components/`, `lib/` buscando interpolaciones pegadas a fragmentos de clase). El resto de las interpolaciones encontradas son fechas, `key`s de React, paths de Storage, URLs y un boundary MIME — ninguna produce un nombre de clase. Las interpolaciones que insertan una clase **entera** (`${rowBg}`, `${e.bgClass}`) son seguras y se dejaron como estaban.

## Hallazgo adicional: el scanner no entiende de comentarios

Al escribir el guard se descubrió que **documentar el bug lo enmascaraba**: el scanner de Tailwind es un match de texto plano y no distingue código de comentarios, así que nombrar las clases completas en un comentario de un archivo de `content` alcanza para que se emitan. La primera versión del fix tenía las cuatro clases escritas en comentarios explicativos y el guard **pasaba en verde con el bug reintroducido**. Los comentarios de `utils.ts` y `Legend.tsx` se reescribieron para nombrar las variantes en prosa; el SSOT es ahora el único lugar del código escaneado donde aparecen literales. Queda anotado en el propio comentario de `utils.ts` para que no vuelva a pasar.

## Verificación

- **El guard es discriminante:** se reintrodujo el bug (volver a componer `ESTADO_BG_CLASS_ESTIMADO` en runtime) y `calendario-clases-tailwind.test.ts` pasó a rojo en 6 tests, con mensaje accionable. La matriz de strings de `calendario-utils.test.ts` siguió en verde bajo el bug — que es exactamente el hueco que este guard cubre.
- **CSS del build real:** `.next/static/css/*.css` contiene las 9 clases (4 sólidas + 4 translúcidas + `vacio`). Antes del fix faltaban `enFranco/35`, `enViaje/35` y `fueraTrabajo/35`.
- **Colores computados en Chromium** (mismo motor que el job de e2e), sobre el CSS del build:
  `bg-calendar-enFranco/35` → `rgba(198, 40, 40, 0.35)` · `bg-calendar-enFranco` → `rgb(198, 40, 40)` · `bg-calendar-vacio` → `rgb(203, 213, 225)` · **clase inexistente → `rgba(0, 0, 0, 0)`** (el síntoma del bug, y lo que afirma la spec).

## Estado de CI (local)

| Job | Resultado |
|---|---|
| Typecheck | ✅ |
| Lint | ✅ sin warnings |
| Tests unitarios | ✅ **753 → 775** (58 → 59 archivos); el archivo nuevo del guard corre en el suite |
| Build | ✅ |
| Integración RLS | ⏸️ no corrido en local (requiere Docker/Supabase local, no disponible en esta máquina). Sin cambios de esquema ni de RLS en este fix. |
| E2E Playwright | ⏸️ no corrido en local (misma razón). Se validaron por separado, con Chromium real y el CSS del build, las tres constantes de color de las que dependen las aserciones. **Pendiente de confirmar en CI.** |
