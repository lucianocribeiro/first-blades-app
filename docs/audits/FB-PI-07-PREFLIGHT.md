# FB-PI-07-PREFLIGHT — Purga del calendario de prueba restante

> **Los dos inventarios coinciden fila por fila con el prompt** (23 días de 3 perfiles y 2 solicitudes de ausencia aprobadas). **Ninguna FK apunta hacia `rotation_assignments` ni hacia `ausencia_requests`, y ninguna de las dos tiene triggers:** borrarlas no arrastra nada más. **0 días de trámite:** el borrado no devuelve saldo a nadie. Las **14 entradas de `audit_log`** que las mencionan se conservan; ninguna FK lo impide.
>
> **Nada se ejecutó.** Este paso fue solo lectura. Cada paso del runbook (§6) requiere autorización explícita de Luciano.

- **Fecha:** 2026-10-06
- **Rama:** `docs/fb-pi-07-purga-calendario-prueba` (desde `main` @ `da081a6`)
- **Prompt:** `docs/prompts/FB-PI-07.md` (Paso 0)
- **Continúa:** FB-PI-06 (purga de `santiago@agenciakairos.net`, PR #53)
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** 3 consultas `SELECT` de solo lectura contra producción (proyecto `simfemdkrkdbumefcxei`): catálogo de FKs y triggers, inventarios fila por fila más totales, y `audit_log`. Sin escrituras.

---

## 1. Inventarios reconfirmados

### `rotation_assignments`: 23 filas ✔

| Perfil | Rol | Días | Rango | Estimados | Composición |
|---|---|---|---|---|---|
| `humberto.dominguez@first-blades.com` | supervisor | **11** ✔ | 01/09 → 11/09 ✔ | **3** ✔ (07, 08 y 09/09) | 7 `en_franco` + 4 `trabajando`, sin motivo. Pintados a mano, sin solicitud de origen |
| `luciano@agenciakairos.net` | admin | **5** ✔ | 01/09 → 05/09 ✔ | 0 ✔ | 5 `periodo_fuera_trabajo` / `vacaciones` |
| `lunajavieralejandro138@gmail.com` | empleado | **7** ✔ | 06/09 → 12/09 ✔ | 0 ✔ | 7 `periodo_fuera_trabajo` / `otros` |

Ninguna fila tiene `notas`.

### `ausencia_requests`: 2 filas, ambas `aprobado` ✔

| `id` | Solicitante | Motivo | Rango | Aprobada por | Días que generó (verificado en calendario) |
|---|---|---|---|---|---|
| `5ed32ac7-c2f6-4b51-98d8-9455e4b2fce7` | `luciano@agenciakairos.net` | vacaciones | 01/09 → 05/09 | el mismo admin (admin-para-sí, FB-ADJ-01) | **5** ✔ |
| `4413df40-b389-492f-a5f8-6cf5bf4a2175` | `lunajavieralejandro138@gmail.com` | otros | 06/09 → 12/09 | `hysadmin@first-blades.com` | **7** ✔ |

Ninguna tiene marca post-aprobación (editada o cancelada). `pasaje_requests` está en **0** ✔: no hay nada que borrar ahí.

### Totales antes de la purga (los que **no** deben cambiar, en negrita)

`rotation_assignments` 23 · `ausencia_requests` 2 · `pasaje_requests` 0 · **`profiles` 27** · **`auth.users` 27** · **`documents` 2** · **objetos del bucket `documents` 2** · **`audit_log` 19** · `notification_log` 0.

## 2. Dependencias de clave foránea

**Hacia** `rotation_assignments` o `ausencia_requests`: **ninguna**. Ninguna tabla las referencia, así que borrar una solicitud **no arrastra nada**: ni días, ni auditoría, ni notificaciones.

**Desde** estas tablas (no afectan el borrado):

| FK | `ON DELETE` | Nota |
|---|---|---|
| `rotation_assignments.user_id → profiles` | CASCADE | Solo actúa si se borra el perfil; acá no se toca |
| `rotation_assignments.rotation_group_id → rotation_groups` | SET NULL | Idem |
| `ausencia_requests.user_id → profiles` | CASCADE | Idem |
| `ausencia_requests.reviewed_by → profiles` | NO ACTION | Idem |

**Triggers:** ninguno en las dos tablas.

**Relación días ↔ solicitud:** no hay FK entre `rotation_assignments` y `ausencia_requests`. El vínculo es lógico (mismo usuario, rango y motivo), así que borrar una no borra la otra. Por eso el prompt pide borrar las dos.

## 3. `audit_log`: 14 entradas las mencionan; todas se conservan

| Acción | Tabla | Cantidad | Fecha |
|---|---|---|---|
| `ausencia_approved` | `ausencia_requests` | 2 (una por solicitud) | 28/08 y 04/09 |
| `ausencia_calendario_sobrescrito` | `rotation_assignments` | 12 (5 + 7, una por día generado; convención por día de 0018) | 28/08 y 04/09 |

- **Ninguna FK impide conservarlas:** `audit_log.record_id` no tiene FK. La única FK de `audit_log` es `actor_id → profiles` (SET NULL), y acá no se borra ningún perfil.
- Quedan apuntando a IDs que dejan de existir, que es lo correcto para la bitácora. `audit_log` se queda en **19**.
- Los días del supervisor no tienen entradas de auditoría: el pintado manual no se audita por día.

## 4. Saldo de días de trámite

**0 de los 23 días son `dia_tramite`** (`motivo_ausencia = 'dia_tramite'`: 0 filas en toda la tabla). **El borrado no devuelve saldo a nadie.**

## 5. Orden de borrado y snapshot

### Orden propuesto: **un solo bloque atómico** con los dos borrados

Como no hay FKs entre las dos tablas, cualquier orden funciona técnicamente. Lo que importa es **el estado intermedio** si algo se corta entre dos pasos separados:

- **Días primero, solicitudes después:** si se corta en el medio, quedan 2 solicitudes `aprobado` sin su efecto en el calendario. Son las **huérfanas** que el prompt quiere evitar.
- **Solicitudes primero, días después:** si se corta, quedan días sin solicitud de origen. Es un estado válido: igual que los pintados a mano del supervisor.

**Propuesta:** los dos `DELETE` en **un único bloque `DO $$ … $$`**, una sola transacción, con guardas que abortan si los conteos no son exactamente **23** y **2**. Si algo falla, no se borra nada y no hay estado intermedio. Dentro del bloque van primero las solicitudes y después los días. Si Luciano prefiere dos autorizaciones separadas, se mantiene ese orden: **solicitudes → días**.

### Snapshot

- **Dónde:** `~/Desktop/Dev/first-blades-backups/FB-PI-07-2026-10-06/`, fuera del repo, junto al de FB-PI-06.
- **Qué (JSON):**

| Archivo | Contenido |
|---|---|
| `rotation_assignments.json` | Las 23 filas completas |
| `ausencia_requests.json` | Las 2 filas completas |
| `audit_log_referencias.json` | Las 14 entradas (referencia; no se borran) |
| `manifest.json` | Conteos, `sha256` de cada JSON, totales de las tablas que no deben cambiar y fecha y hora del snapshot |

- **Sin archivos de Storage** en este trabajo.
- **Cómo:** script local de solo lectura con la service role, que no se commitea. Verifica que los conteos den 23, 2 y 14, que los `sha256` releídos desde disco coincidan y que cada día de las solicitudes esté en el JSON de días.
- **Reconstrucción:** `INSERT` desde los JSON, con los `id` preservados. Primero las solicitudes y después los días; el orden da igual, porque no hay FK entre ellas.

## 6. Runbook (cada paso, solo con autorización explícita de Luciano)

### Paso 1 — Snapshot
Como en §5.

### Paso 2 — Borrado (un bloque atómico)

```sql
DO $$
DECLARE n int;
BEGIN
  -- guardas de alcance: exactamente lo inventariado
  SELECT count(*) INTO n FROM public.ausencia_requests
   WHERE id IN ('5ed32ac7-c2f6-4b51-98d8-9455e4b2fce7', '4413df40-b389-492f-a5f8-6cf5bf4a2175') AND estado = 'aprobado';
  IF n <> 2 THEN RAISE EXCEPTION 'FB-PI-07: se esperaban las 2 solicitudes aprobadas, hay %', n; END IF;
  SELECT count(*) INTO n FROM public.ausencia_requests;
  IF n <> 2 THEN RAISE EXCEPTION 'FB-PI-07: ausencia_requests tiene % filas, se esperaban 2', n; END IF;
  SELECT count(*) INTO n FROM public.rotation_assignments;
  IF n <> 23 THEN RAISE EXCEPTION 'FB-PI-07: rotation_assignments tiene % filas, se esperaban 23', n; END IF;

  DELETE FROM public.ausencia_requests
   WHERE id IN ('5ed32ac7-c2f6-4b51-98d8-9455e4b2fce7', '4413df40-b389-492f-a5f8-6cf5bf4a2175');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'FB-PI-07: se borraron % solicitudes, se esperaban 2', n; END IF;

  DELETE FROM public.rotation_assignments;  -- el objetivo es dejarla vacía; la guarda de arriba fija las 23
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 23 THEN RAISE EXCEPTION 'FB-PI-07: se borraron % días, se esperaban 23', n; END IF;
END $$;
```

### Paso 3 — Verificación posterior

| Medida | Antes | Esperado después |
|---|---|---|
| `rotation_assignments` | 23 | **0** |
| `ausencia_requests` | 2 | **0** |
| `pasaje_requests` | 0 | 0 |
| `profiles` / `auth.users` | 27 / 27 | **27 / 27** (si cambia, algo salió mal) |
| `documents` / objetos del bucket | 2 / 2 | **2 / 2** (si cambia, algo salió mal) |
| `audit_log` | 19 | **19**, con las 14 entradas de §3 intactas |

Más los errores de runtime de Vercel (Calendario, Equipo y Aprobaciones sin errores) y la confirmación visual de Luciano.

## 7. Acciones que tocaron producción en este paso

Solo las 3 consultas `SELECT` de §0 (método). Ninguna escritura.

---

## 8. Registro de ejecución

**Formato del borrado elegido por Luciano: un solo bloque atómico** (§6, Paso 2). Se ejecuta recién con su autorización explícita de ese paso.

### Paso 1 — Snapshot ✅ (autorizado por Luciano, 2026-10-06)

- **Carpeta:** `~/Desktop/Dev/first-blades-backups/FB-PI-07-2026-10-06/`, fuera del repo y no commiteada.
- **Contenido:** `rotation_assignments.json` (23) · `ausencia_requests.json` (2) · `audit_log_referencias.json` (14) · `manifest.json`.
- **Verificación:**
  - Conteos 23, 2 y 14, iguales a lo esperado. Las 2 solicitudes inventariadas están presentes y `aprobado`.
  - Cada día generado por las solicitudes está en el JSON de días (5 y 7).
  - Los `sha256` releídos desde disco coinciden: `rotation_assignments.json` `afd3e47b09db83ea…` · `ausencia_requests.json` `ed3fe05b86a73d70…` · `audit_log_referencias.json` `a45253047fe98e31…`.
- **Totales que no deben cambiar** (guardados en el manifest): `profiles` 27 · `auth.users` 27 · `documents` 2 · objetos del bucket `documents` 2 · `audit_log` 19 · `pasaje_requests` 0.
- **Corrección del manifest:** el script tomó el conteo del bucket con `list('')`, que devuelve carpetas de primer nivel (1), no objetos. Se reemplazó en el manifest por el conteo real por SQL (2). Los JSON hasheados no se tocaron.
- **Producción:** solo lectura (`SELECT`, `listUsers` de Auth y listado de Storage). **Ninguna escritura.**
