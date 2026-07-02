# PRD — Fase 3: Calendario de Rotaciones

> Lo construye el chat Developer de Fase 3 (vía Claude Code). Lo audita Codex. Alineado con la Constitución v0.5 (las definiciones de calendario de abajo son firmes y se absorben en el bump a v0.6). Es el módulo más grande del proyecto.

## Objetivo
Módulo de calendario operativo para gestionar rotaciones, francos y ausencias del personal de campo, con planificación futura, alertas informativas y carga de historial.

## En alcance

### Estados y colores
- **4 estados:** `trabajando`, `en_viaje`, `en_franco`, `periodo_fuera_trabajo`. Este último exige seleccionar **motivo** de un desplegable (vacaciones, licencia médica, día de trámite, matrimonio, fallecimiento, otros → texto libre).
- **Colores:** `trabajando` verde · `en_franco` rojo · `periodo_fuera_trabajo` amarillo (un solo color, sin importar el motivo) · `en_viaje` **azul (propuesto — reconciliar con las fotos de UI de Nicolás)**. Celda sin cargar = gris (default, no es un estado). **Leyenda de colores** visible.

### Vista roster
- Mensual, navegable por rango (3–6 meses). **Días = columnas, empleados = filas** (mismo esquema que el Excel de rotaciones actual). Las modificaciones se hacen sobre el mismo calendario (sin herramienta separada).

### Estimados (planificación futura)
- Los días futuros planificados se muestran en **tono más claro** + **leyenda** que lo explica.
- El admin los **edita libremente**.
- Un estimado pasa a **real automáticamente 1 semana (7 días) antes** de la fecha.
- Aun siendo real, el admin puede modificarlo, pero esos cambios siguen el **proceso de solicitud de ausencias** (se completa en Fase 4; en Fase 3 el admin edita directo).

### Permisos
- Admin **gestiona**; supervisor ve **su equipo** (lectura); empleado ve **el suyo** (lectura). RLS de `rotation_*` según constitución §6.

### Alertas informativas (solo admin, no decisionales)
- 48 y 60 días **trabajados sin franco**; 10–12 días de **franco corridos**. No modifican el calendario. **Reutilizan la capa de email + `notification_log` + skill `email-notification` de Fase 2.**

### Días de trámite
- 3 por año calendario, no acumulables, no todos juntos ni concentrados en diciembre; solicitud con anticipación + aprobación; **historial de consumo por empleado**.

### Reglas de viaje
- Viaje > 12 h = "día de viaje" (no cuenta como franco ni como trabajo). *(La automatización que convierte "motivo del viaje" en cambios de calendario es Fase 4.)*

### Carga de historial (Excel)
- La app **exporta un template Excel** con la estructura de carga; el admin lo completa (60 días iniciales) e **importa**. **Export e import = solo admin.** Sirve para la carga inicial y para cargas masivas en general.

## Para resolver al arranque (con Nicolás / Humberto)
1. **Color de `en_viaje`** (propuesta: azul) + reconciliación de la paleta con las fotos de UI previas de Nicolás.
2. Validación del roster/calendario con Humberto.

## Fuera de alcance (otras fases)
Flujo nativo de solicitud de ausencias/pasajes (Fase 4) · automatización motivo-de-viaje → calendario (Fase 4) · Procedimientos (Fase 5) · Viáticos (Fase 6).

## Datos / RLS
- `rotation_groups`, `rotation_assignments` (ya en constitución: `estado_dia`, `motivo_ausencia`, `motivo_otros_texto`).
- Distinción **estimado vs real** (flag en `rotation_assignments` o derivado por fecha + promoción a 7 días) — definir en build.
- Estructura de **días de trámite** (consumo por empleado y año) — definir en build.
- Reusar `notification_log` (Fase 2) para las alertas.
- RLS: admin completo; supervisor SELECT su equipo; empleado SELECT lo suyo; sin escritura para no-admin.

## Criterios de aceptación (testeables)
- [ ] El admin carga y edita estados en el roster; los 4 estados funcionan; `periodo_fuera_trabajo` exige motivo.
- [ ] Colores correctos + leyenda; los estimados se ven en tono claro; un estimado pasa a real 7 días antes.
- [ ] Supervisor ve su equipo en lectura; empleado ve el suyo; ninguno edita (test RLS).
- [ ] Las alertas 48/60 y 10–12 disparan aviso al admin (email + in-app) sin modificar el calendario.
- [ ] Días de trámite: 3/año, no acumulables, con historial de consumo por empleado.
- [ ] Import Excel: template exportable + import; ambos solo admin; carga los 60 días de historial.
- [ ] **Migraciones aplicadas y verificadas en producción** (`supabase db push` tras CI verde).
- [ ] RLS testeada; copy es-AR; tests pasando; CI en verde; auditoría de Codex limpia.

## Reutilización (no rehacer)
Capa de email + `notification_log` + skill `email-notification` (Fase 2) para las alertas. Skills base del repo; shell; roles/RLS. Por el tamaño, el developer puede **secuenciar internamente** (roster/estados → alertas → días de trámite → import), manteniéndolo como una sola fase.

---

## Decisiones de build cerradas por el chat Developer de Fase 3 (refinan la letra de la Constitución v0.5; se absorben en el bump a v0.6)

Estas decisiones resuelven los puntos marcados como "definir en build" arriba. Son la referencia firme para Claude Code y Codex en Fase 3.

1. **Colores:** manda esta tabla del PRD sobre §9 de la Constitución → `trabajando` verde · `en_franco` rojo · `periodo_fuera_trabajo` amarillo (un solo color) · `en_viaje` azul (propuesto, a reconciliar con Nicolás). Celda sin cargar = gris default (no es estado). Leyenda visible.
2. **Estimado vs real:** columna explícita `es_estimado boolean NOT NULL DEFAULT false` en `rotation_assignments`. Un cron nocturno la pasa a `false` (real) cuando `fecha <= hoy + 7 días`. Promoción auditable.
3. **Modelo de `rotation_assignments`: per-día.** Una fila por `(profile_id, fecha)` con un único `estado_dia` + `es_estimado`, con `UNIQUE (profile_id, fecha)`. Refina el modelo de rango (`fecha_inicio`/`fecha_fin`) de §5, para soportar edición por celda y promoción estimado→real por fecha.
4. **Motivo obligatorio** cuando `estado_dia = 'periodo_fuera_trabajo'`, aplicado por CHECK constraint a nivel de base.
5. **Días de trámite:** tabla propia keyed por `(profile_id, año)` con historial de consumo (3/año, no acumulables).
6. **Conteo de días sin franco (alertas):** `en_viaje` es **neutral** (ni franco ni día trabajado; se saltea del conteo). `periodo_fuera_trabajo` resetea la racha (default asumido, a confirmar con Humberto).
7. **Alertas admin-only:** tipo `sin_franco` con umbrales `[48, 60]`; tipo `franco_excedido` con umbrales `[10, 12]`. Reutilizan `lib/email` + `notification_log` + skill `email-notification`.
8. **Import de historial:** clave de identificación del empleado = **DNI**. Se agrega columna `dni text UNIQUE` (nullable) a `profiles` (el admin la puebla). No existe Excel ni sistema de calendario previo; el template se arma en Fase 3.
9. **`group_id` nullable, sin UI de grupos** en Fase 3 (semántica de `rotation_groups` sin definir; se preserva la columna).
10. **Interfaz con Fase 4:** el modelo debe soportar que una ausencia aprobada (Fase 4) genere `periodo_fuera_trabajo`, aunque el flujo nativo de ausencias sea de Fase 4.
