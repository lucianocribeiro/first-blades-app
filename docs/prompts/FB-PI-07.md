# FB-PI-07 — Purga del calendario de prueba restante

- **ID:** FB-PI-07
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-07.md`
- **Continúa:** `FB-PI-06` (purga de `santiago@agenciakairos.net`, completa y verificada)
- **Origen:** Luciano — "todo lo que está en el calendario ahora son datos de prueba". Vinculado a `rec6lc5PmxwIUSW3P`.
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna. Es **DML destructivo**.

---

## ⚠️ Mismas reglas que `FB-PI-06`

Borra datos de producción y es irreversible. Sin staging.

- **Nada se ejecuta sin autorización explícita de Luciano, paso por paso.**
- Dry-run primero. Snapshot antes. Verificación después. Reportar toda acción que toque producción (§2.3).
- Si algún número no coincide con el inventario de abajo, **frená y reportá**.

---

## Objetivo

Dejar `rotation_assignments` **vacía** y eliminar las 2 solicitudes de ausencia aprobadas que generaron parte de esos días. Es el remanente de datos de prueba tras la purga de Santiago.

**Acá NO se borran perfiles, usuarios, documentos ni archivos.** Los 27 perfiles quedan intactos. Lo único que se toca es calendario y esas 2 solicitudes.

---

## Inventario verificado contra producción (06/10)

**`rotation_assignments` — 23 filas, 3 perfiles:**

| Perfil | Rol | Días | Rango | Estimados |
|---|---|---|---|---|
| `humberto.dominguez@first-blades.com` | supervisor | 11 | 01/09 → 11/09 | 3 |
| `luciano@agenciakairos.net` | admin | 5 | 01/09 → 05/09 | 0 |
| `lunajavieralejandro138@gmail.com` | empleado | 7 | 06/09 → 12/09 | 0 |

**`ausencia_requests` — 2 filas, ambas `aprobado`:**

| Solicitante | Motivo | Rango | Días que generó |
|---|---|---|---|
| `luciano@agenciakairos.net` | vacaciones | 01/09 → 05/09 | 5 |
| `lunajavieralejandro138@gmail.com` | otros | 06/09 → 12/09 | 7 |

**Las 2 solicitudes se borran junto con los días.** Si se borraran solo los días, quedarían dos solicitudes en estado "aprobado" cuyo efecto en el calendario ya no existe: solicitudes huérfanas, y una inconsistencia peor que el dato de prueba.

`pasaje_requests` está vacía: no hay nada que borrar ahí.

---

## Paso 0 — Preflight ⛔ (solo lectura)

1. Reconfirmá los dos inventarios contra producción, fila por fila.
2. **Dependencias de clave foránea** sobre `ausencia_requests` y `rotation_assignments`: qué apunta a ellas y con qué `ON DELETE`. En particular, si borrar una solicitud arrastra algo más.
3. **`audit_log`:** listá las entradas que mencionen estas solicitudes o estos días. **No se borran.** Confirmá que ninguna FK impida conservarlas.
4. **Saldo de días de trámite:** confirmá si alguno de los 23 días es `dia_tramite`. Si lo hubiera, borrarlo devuelve saldo a esa persona; decilo explícitamente.
5. Orden de borrado propuesto y plan de snapshot.

**Entregable:** `docs/audits/FB-PI-07-PREFLIGHT.md`, commiteado. **Frená acá.**

---

## Paso 1 — Snapshot

Mismo criterio que `FB-PI-06`: JSON de las filas a borrar, más manifest con conteos y hashes, fuera del repo. Acá **no hay archivos de Storage** involucrados.

---

## Paso 2 — Borrado

Con autorización explícita, en el orden del preflight:

- Las 23 filas de `rotation_assignments`
- Las 2 filas de `ausencia_requests`

Cada bloque **aborta si el conteo no es exactamente 23 y 2**.

El `audit_log` se conserva.

---

## Paso 3 — Verificación posterior

- `rotation_assignments` en **0** filas. `ausencia_requests` en **0**.
- `profiles` sigue en **27**, `auth.users` en **27**, `documents` en **2**, archivos del bucket en **2**. **Si alguno de estos cambió, algo salió mal.**
- `audit_log` sigue en 19.
- Que la app cargue sin error: Calendario, Equipo y Aprobaciones.

---

## Nota para el próximo item (no actuar acá)

Las 3 filas que todavía tienen `es_estimado = true` son del supervisor y **se van con esta purga**. Eso hace desaparecer el síntoma del item `recQzoGnSvpEHfAYg`, pero **no el problema**: si los crons de Vercel no corren, la consolidación va a volver a fallar con los datos nuevos, y esta vez sin filas viejas que lo delaten.

El diagnóstico de los crons es el **siguiente trabajo, inmediatamente después de esta purga** y antes del import y de cargar el historial. Decisión de Luciano. No lo toques en este prompt.

---

## Fuera de alcance

- Perfiles, usuarios de Auth, documentos, archivos de Storage, procedimientos. **Nada de eso se toca.**
- El `audit_log`.
- El diagnóstico de los crons.
- El import de calendario.

---

## Definición de Done

- [ ] `docs/audits/FB-PI-07-PREFLIGHT.md` commiteado con inventarios reconfirmados y FKs.
- [ ] Snapshot generado y verificado antes de borrar.
- [ ] 23 + 2 filas borradas, con bloques que abortan ante conteo distinto.
- [ ] Verificación posterior completa, incluido que perfiles, documentos y archivos **no** cambiaron.
- [ ] `audit_log` intacto.
- [ ] Toda acción que tocó producción, reportada.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-07.md`.

**Cada paso destructivo requiere autorización explícita de Luciano.**
