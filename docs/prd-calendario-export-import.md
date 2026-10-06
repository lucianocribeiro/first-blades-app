# PRD — Módulo Export / Import de calendario (Excel)

- **Fecha:** 14 de septiembre de 2026
- **Guardar en:** `docs/prd-calendario-export-import.md`
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Origen:** decisión de Luciano. Relacionado con el item de Parking Lot `recjnQSEYngtv6jZA` (Import/Export Excel), que queda absorbido por este PRD en lo que respecta a calendario.
- **Entrega en dos PRs:** Export primero (solo lectura, riesgo bajo), Import después (escritura masiva, requiere migración).

---

## 1. Objetivo

Que el admin pueda **exportar el calendario a Excel, completarlo fuera de la app y volver a importarlo**. El caso de uso inmediato es cargar el historial de los últimos tres meses, pero el módulo queda disponible de forma permanente.

Es una decisión de producto tomada: no es un script de carga única.

---

## 2. Alcance

### En alcance
- Export del calendario a `.xlsx`, con desplegables de validación en las celdas editables.
- Import del mismo archivo, con **previsualización obligatoria** antes de escribir.
- Ambas funciones **solo admin**.

### Fuera de alcance
- Export/import de cualquier otra entidad (documentos, perfiles, solicitudes, procedimientos).
- Importar perfiles nuevos. El import **nunca crea empleados**: si un email no existe en `profiles`, es error de validación, no un alta.
- Modificar solicitudes de ausencia o pasaje. El import escribe calendario, no toca `ausencia_requests` ni `pasaje_requests`.
- CSV. El formato es `.xlsx` porque los desplegables son parte del requerimiento.

---

## 3. Export

### Entrada del admin
- Rango de fechas (desde / hasta).
- Alcance de empleados: **empleados y supervisores activos**. Los **admins quedan excluidos** (decisión de Luciano, 14/09), con el mismo alcance que el roster del admin. Consecuencia asumida: un admin puede tener días de calendario propios, porque una ausencia o pasaje que se envía a sí mismo se auto-aprueba y escribe su calendario (§7, FB-ADJ-01); esos días **no salen en el export ni se pueden corregir por Excel**. Se gestionan desde la app.
- Sin selector individual de empleados en esta versión.

### Salida
Un `.xlsx`, **una fila por empleado y por día del rango**, incluidos los días sin ninguna asignación, que salen en blanco listos para completar. Ese es el punto: sobre un calendario vacío, el archivo es la grilla a llenar.

### Columnas

| Columna | Editable | Contenido |
|---|---|---|
| `email` | No (bloqueada) | Clave de identificación del empleado |
| `nombre` | No (bloqueada) | `full_name`, solo para que el admin se ubique |
| `fecha` | No (bloqueada) | Fecha del día, formato ISO `AAAA-MM-DD` |
| `estado` | **Sí, desplegable** | Trabajando · En franco · En viaje · Fuera del trabajo · (vacío = sin asignar) |
| `motivo` | **Sí, desplegable** | Vacaciones · Licencia médica · Día de trámite · Matrimonio · Fallecimiento · Otros. Obligatorio si el estado es Fuera del trabajo; vacío en los demás casos |
| `motivo_otros` | Sí, texto | Obligatorio si el motivo es Otros |
| `notas` | Sí, texto | Campo libre existente |

**Decisión de clave:** el identificador es **email**, no DNI. Verificado contra producción: los 28 perfiles tienen email y los 28 son distintos, mientras que 25 de 28 no tienen DNI cargado. La constitución designa `dni` como clave de import de historial; esa designación **no es aplicable hoy** y hay que corregirla o cargar los DNIs primero.

**Etiquetas vs. valores de base:** el Excel muestra etiquetas en es-AR legibles. El mapeo a los valores del enum (`trabajando`, `en_franco`, `en_viaje`, `periodo_fuera_trabajo`) vive en el servidor, en una tabla de mapeo única compartida por export e import. No duplicar ese mapeo.

**Hoja de referencia:** una segunda hoja con las combinaciones válidas de estado y motivo, para que el admin no tenga que adivinar.

### Nota sobre los desplegables
Se implementan como validación de datos de Excel. **No son un control de seguridad:** cualquiera puede pegar texto encima y Excel lo acepta. Toda la validación real corre server-side en el import. El desplegable es comodidad, nada más.

Verificar en la implementación si la validación sobrevive al abrir el archivo en Google Sheets, y reportarlo. No se da por sentado.

---

## 4. Import

### Flujo
1. El admin sube el archivo.
2. **Previsualización obligatoria.** No se escribe nada todavía.
3. El admin confirma o cancela.
4. Escritura atómica.

La previsualización no es opcional ni se puede saltear. Una importación mal armada reescribe el calendario de todo el equipo y no hay forma de deshacerla.

### Qué muestra la previsualización
- Filas a crear, a modificar y sin cambios.
- **Días que hoy provienen de una solicitud aprobada y que la importación va a pisar**, listados uno por uno con empleado y fecha. Decisión tomada: **se pisan**. Pero el admin los ve antes de confirmar.
- Errores de validación, con fila y motivo: email inexistente, fecha fuera del rango exportado, estado inválido, motivo faltante u obligatorio no completado.
- **Impacto en el saldo de días de trámite:** por cada empleado, cuántos días de trámite tendría tras la importación y si eso excede el tope de 3 del año calendario. Decisión tomada: el import **acepta** días de trámite. El saldo se deriva del calendario, así que importarlos lo consume retroactivamente; por eso se muestra antes, no después.
- Si hay errores de validación, **no se puede confirmar**. Se corrige el archivo y se vuelve a subir.

### Reglas de escritura
- **Upsert por `(email, fecha)`**, que se resuelve al `UNIQUE(user_id, fecha)` de `rotation_assignments`.
- Celda de estado vacía = **día sin asignar**. Si existía una fila, se borra. Esto debe estar explícito en la previsualización: vaciar una celda es borrar un día, no "dejarlo como está".
- `es_estimado = false` para todo día pasado. Son días reales, no proyecciones.
- El import **no toca** `ausencia_requests` ni `pasaje_requests`, ni siquiera cuando pisa un día que una de ellas generó.

### Atomicidad y seguridad
La escritura va en una función `SECURITY DEFINER` invocada con `.rpc()`, siguiendo el molde de §6.1: guardas internas de admin contra `auth.uid()` tratando NULL como no-admin, `search_path` fijo, `EXECUTE` solo a `authenticated` con `REVOKE` de `anon` y `PUBLIC`, owner verificado por catálogo post-push.

**Esto implica migración**, así que el módulo va con la ceremonia completa: auditoría de esquema previa, runbook de `db push` gateado por Luciano, verificación de catálogo posterior, regen de tipos.

Las Server Actions siguen el contrato return-based (§2.5) y leen el `{ error }` de PostgREST como valor.

### `audit_log` — decidido (Luciano, 14/09): modelo híbrido

La convención vigente es una fila de `audit_log` por día de calendario afectado (§6.1, migración 0018). Una importación de tres meses para 27 empleados generaría del orden de miles de filas en una sola operación, así que para este módulo se adopta un modelo híbrido:

- **Una entrada de resumen por importación**: quién, cuándo, rango de fechas, cantidad de filas creadas, modificadas y borradas.
- **Más una entrada por-día, solo** para los días que pisaron una solicitud aprobada. Son los que importan para la trazabilidad entre la solicitud y su efecto en el calendario.

Es una excepción consciente a la convención por-día de §6.1, acotada a la importación masiva. Toda otra escritura de calendario mantiene la convención existente. Al cerrar el módulo hay que registrarla en la constitución.

---

## 5. Permisos y RLS

- Export e import: **solo admin**, verificado server-side, no solo oculto en la UI.
- La RLS sigue siendo el control real. El guard de rol corta por `redirect()`, no por `{ ok }` (§2.5, excepción FB-F5-AUD-05).

---

## 6. Dependencias previas

El módulo se puede construir en paralelo, pero **la importación real del historial no corre hasta que estén hechas estas dos purgas**:

1. **Purga de `santiago@agenciakairos.net`** (empleado, inactivo desde el 07/09): perfil, usuario de Auth, 2 documentos con archivo en Storage, 46 días de calendario. Los archivos se borran con la API de Storage, nunca por SQL, por el trigger `storage.protect_delete()`. Runbook gateado, snapshot previo.
2. **Purga del calendario de prueba restante**: los días que queden de las 69 filas tras sacar los de Santiago, más las 2 `ausencia_requests` aprobadas que generaron 12 de esos días. Solo SQL, sin Storage ni Auth.

El `audit_log` se conserva en ambos casos. Es la bitácora; borrar historia de auditoría es peor que registrar algo que después se purgó.

Ambas se vinculan al item `rec6lc5PmxwIUSW3P` del Log, que ya tenía la checklist de purga.

---

## 7. Hallazgos de documentación a corregir

Detectados al inspeccionar producción para este PRD, van al item `rec2CQcbv5jKODcAF`:

- `ausencia_requests` usa `user_id` y `motivo_ausencia`; la constitución §5 los documenta como `profile_id` y `motivo`.
- `documents` usa `user_id` y `storage_path`; §5 los documenta como `profile_id` y `file_path`.
- §5 designa `dni` como clave de import de historial, pero 25 de 28 perfiles no lo tienen cargado.
- **A verificar, no confirmado:** hay 19 filas de calendario con fecha pasada todavía marcadas `es_estimado = true`. Según §5 el cron nocturno debería haberlas consolidado. Puede ser que el cron no esté corriendo.

---

## 8. Criterios de aceptación

**Export**
- [ ] Solo admin. Supervisor y empleado no acceden, verificado por test de rol.
- [ ] El archivo trae una fila por empleado activo y por día del rango, incluidos los días sin asignación.
- [ ] Las celdas de estado y motivo tienen desplegable; email, nombre y fecha están bloqueadas.
- [ ] Reportado si la validación sobrevive en Google Sheets.
- [ ] Etiquetas es-AR desde `/lib/copy`.

**Import**
- [ ] Solo admin, verificado server-side.
- [ ] Previsualización obligatoria, imposible de saltear.
- [ ] La previsualización lista los días que pisan solicitudes aprobadas y el impacto en el saldo de días de trámite.
- [ ] Con errores de validación, la confirmación queda bloqueada.
- [ ] Un archivo exportado y reimportado sin cambios deja la base igual: cero diferencias. Test de ida y vuelta.
- [ ] Escritura atómica: si falla una fila, no queda nada a medias.
- [ ] Migración aplicada por el runbook gateado, con verificación de catálogo.
- [ ] CI verde en los tres jobs. Auditoría de Codex limpia. Copy es-AR.
