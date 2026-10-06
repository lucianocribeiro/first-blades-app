# FB-PI-06 — Purga del usuario inactivo `santiago@agenciakairos.net`

- **ID:** FB-PI-06
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-06.md`
- **Origen:** pedido de Luciano. Se vincula al item de Parking Lot `rec6lc5PmxwIUSW3P` ("Plan de purga de datos de prueba en producción"), que queda **parcialmente** ejecutado por este trabajo.
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna. Esto es **DML destructivo**, no DDL.

---

## ⚠️ Naturaleza de este trabajo

Esto **borra datos reales de producción y es irreversible.** No hay staging: la purga corre contra la única base que existe.

Reglas no negociables:

- **Nada se ejecuta sin autorización explícita de Luciano**, paso por paso. No alcanza con que el plan esté aprobado.
- **Dry-run primero, siempre.** Todo lo que vaya a borrar se lista antes, con conteos exactos, sin tocar nada.
- **Snapshot previo** de todo lo que se va a borrar, guardado antes de ejecutar.
- **Verificación posterior** con el mismo criterio que un `db push`.
- **Reportá toda acción que toque producción** (§2.3).

Si en cualquier punto encontrás algo que no coincide con el inventario de abajo, **frená y reportá**. Un número distinto significa que el estado cambió y el plan hay que rehacerlo.

---

## Objetivo

Eliminar por completo al usuario `santiago@agenciakairos.net` de producción: perfil, usuario de Auth, archivos en Storage y sus días de calendario.

Es un empleado inactivo, dado de baja el 07/09 con motivo "Desafectación". El perfil figura con `full_name` = "David".

---

## Inventario verificado (consultado contra producción)

| Elemento | Cantidad |
|---|---|
| Perfil en `profiles` | 1 (rol `empleado`, estado `inactivo`) |
| Usuario en `auth.users` | 1 |
| Días en `rotation_assignments` | **46** (del 01/07 al 11/09) |
| Documentos en `documents` | 2, **ambos con archivo en Storage** |
| Ausencias / pasajes | 0 |
| Procedimientos creados o editados | 0 |
| Entradas de `audit_log` como actor | 0 |
| Empleados a cargo (`supervisor_id`) | 0 |

No es admin, no tiene gente a cargo y no deja nada huérfano. Es el caso más limpio posible.

**Confirmá estos números en el Paso 0 antes de tocar nada.** Si alguno cambió, frená.

---

## Paso 0 — Preflight (obligatorio, con informe versionado) ⛔

**No ejecutes nada destructivo en este paso.** Solo lectura.

1. **Reconfirmá el inventario completo** contra producción, elemento por elemento.
2. **Mapeá las dependencias de clave foránea** que apunten a este perfil: `rotation_assignments`, `documents`, `ausencia_requests`, `pasaje_requests`, `audit_log`, `procedures`, `profiles.supervisor_id`, y cualquier otra. Para cada una, **cuál es el comportamiento `ON DELETE`** (cascade, restrict, set null). Esto decide el orden de borrado y si algo va a bloquear.
3. **Relación entre `profiles` y `auth.users`:** ¿borrar uno arrastra al otro, o hay que hacer los dos? ¿En qué orden?
4. **Rutas exactas de los 2 archivos en el bucket `documents`**, y confirmación de que existen.
5. **`audit_log`:** confirmá que no haya entradas donde este usuario sea `actor_id`, y listá las que lo mencionen como `record_id` de otra tabla. **El `audit_log` NO se borra:** es la bitácora, y borrar historia de auditoría es peor que conservar el registro de algo que después se purgó. Decí explícitamente si alguna FK impide conservarlo.
6. **Orden de borrado propuesto**, justificado por las dependencias.
7. **Plan de snapshot:** qué se guarda, en qué formato y dónde. Tiene que alcanzar para reconstruir lo borrado si hiciera falta.

**Entregable:** `docs/audits/FB-PI-06-PREFLIGHT.md`, commiteado, con el runbook paso a paso que Luciano va a gatear.

**Frená acá y entregá el informe.** No sigas al Paso 1 sin autorización.

---

## Paso 1 — Snapshot

Con autorización: generá y guardá el snapshot definido en el preflight, **antes** de borrar nada. Confirmá que quedó guardado y dónde.

---

## Paso 2 — Archivos de Storage

- Los 2 archivos se borran **con la API de Storage, nunca por SQL.** Existe el trigger `storage.protect_delete()`, y un `DELETE` directo sobre las tablas de storage no es la ruta correcta.
- Verificá después que ya no existan.

---

## Paso 3 — Datos de la base

Borrá, en el orden que haya definido el preflight:

- Las 46 filas de `rotation_assignments`
- Los 2 registros de `documents`
- El perfil de `profiles`
- El usuario de `auth.users`

**El `audit_log` se conserva.**

Cada paso con su verificación de conteo antes y después.

---

## Paso 4 — Verificación posterior

Reportá:

- Conteos finales de cada tabla afectada.
- Que el email ya no existe ni en `profiles` ni en `auth.users`.
- Que los 2 archivos ya no están en Storage.
- **Estado del calendario de prueba restante:** tras sacar los 46 días de Santiago, cuántas filas quedan en `rotation_assignments` y de qué empleados. Ese remanente es el objeto del próximo trabajo, no de éste.
- Que la app sigue funcionando: Calendario, Equipo y Aprobaciones cargan sin error.

---

## Fuera de alcance

- **La purga del calendario de prueba restante y de las 2 `ausencia_requests` aprobadas.** Va en su propio prompt, después de éste.
- Cualquier otro usuario, documento o procedimiento. Los otros 27 perfiles **no se tocan**.
- El `audit_log`.
- El import de calendario.
- Los desfasajes de documentación de la constitución.

---

## Definición de Done

- [ ] `docs/audits/FB-PI-06-PREFLIGHT.md` commiteado, con inventario reconfirmado, dependencias de FK y runbook.
- [ ] Snapshot generado y guardado antes de borrar.
- [ ] Archivos de Storage borrados con la API de Storage, verificado.
- [ ] Datos borrados en el orden correcto, con conteos antes y después.
- [ ] `audit_log` intacto.
- [ ] Verificación posterior completa, incluido el remanente de calendario de prueba.
- [ ] Toda acción que tocó producción, reportada.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-06.md`.

**Cada paso destructivo requiere autorización explícita de Luciano.** El plan aprobado no es autorización para ejecutar.
