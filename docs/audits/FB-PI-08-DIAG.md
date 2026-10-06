# FB-PI-08-DIAG — Diagnóstico: los crons de Vercel en producción

> **¿Corren los crons? NO, al menos no con éxito.** Los datos lo prueban: el cron de consolidación de `es_estimado` y el de purga de documentos rechazados **no tuvieron ninguna ejecución exitosa en 73 y 74 días consecutivos** (25/07 → 06/10). Los dos son los más simples del proyecto y dependen solo de la service role, que sí está configurada en producción. Por eso el problema **está antes de la lógica**: o Vercel no los invoca, o el endpoint los rechaza con `401`.
>
> **La causa exacta no se puede confirmar con el acceso de esta sesión.** La API de Vercel devolvió `403` al listar variables de entorno, el plan Hobby retiene solo 1 hora de logs (los crons corren entre las 03:00 y las 06:59 UTC) y el panel de Cron Jobs no es accesible. Quedan **dos causas candidatas**, en orden de probabilidad:
> 1. **`CRON_SECRET` ausente o distinta en el entorno Production** → cada invocación recibe `401` y no hace nada. Los cuatro endpoints fallan cerrado si la variable falta. El repo **afirma** que existe ("ya existe como env var, de Fase 2", `FB-F3-07`), pero **ningún documento lo verificó** contra Vercel, y tampoco está en el `.env.local` de desarrollo.
> 2. **Crons no registrados o deshabilitados** en el proyecto de Vercel.
>
> **Descartadas con evidencia:** límites del plan, entorno o rama, redirect del middleware, cacheo de la ruta, zona horaria, fallo silencioso de la lógica y falta de la service role (§C).
>
> **Mails:** hasta hoy **no se perdió ninguna alerta**, porque nunca se dio una condición de disparo (§D). Pero el canal de mail **tampoco está verificado** en producción, y con los crons arreglados podría fallar por las variables de Gmail.
>
> **Para cerrar la causa hace falta una de dos cosas:** que Luciano mire dos pantallas del panel de Vercel, o autorizar una prueba **sin escrituras** (§E).

- **Fecha:** 2026-10-06
- **Rama:** `docs/fb-pi-08-diag-crons` (desde `main` @ `d8f8f06`)
- **Prompt:** `docs/prompts/FB-PI-08.md` (Paso 0)
- **Constitución de referencia:** `docs/constitucion.md` v0.8
- **Método:** lectura del código; consultas de solo lectura a la API de Vercel (proyecto, equipo, deployment, logs de runtime y documentación) y a la base de producción (`SELECT`); análisis de los snapshots de FB-PI-06 y FB-PI-07. **Ninguna escritura y ningún cron disparado.**

---

## A. ¿Existen y están configurados?

### A.1 Declarados en `vercel.json` (4)

| Ruta | Schedule (UTC) | Hora AR | Qué hace |
|---|---|---|---|
| `/api/cron/purge-rejected-docs` | `0 3 * * *` | 00:00 | Borra de Storage el archivo de documentos `rechazado` con más de 30 días (`lib/purge.ts`) y marca `file_purged_at` |
| `/api/cron/document-expiry-alerts` | `0 4 * * *` | 01:00 | Manda mail al dueño y a los admins por documentos aprobados que vencen en 30, 15 o 5 días; registra en `notification_log` |
| `/api/cron/promote-estimated-days` | `0 5 * * *` | 02:00 | `es_estimado → false` para los días con `fecha ≤ hoy + 7` (`lib/rotation/promote-estimated.ts`) |
| `/api/cron/franco-alerts` | `0 6 * * *` | 03:00 | Manda mail a los admins por rachas sin franco (48/60 días) o con franco prolongado (10/12 días); registra en `notification_log` |

### A.2 Endpoints

Los cuatro son `GET` en `app/api/cron/*/route.ts`, con el mismo guard:

```ts
if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
}
```

**Fallan cerrado:** si `CRON_SECRET` no existe en el entorno, **toda** invocación, incluida la de Vercel, recibe `401` sin ejecutar nada y **sin loguear nada** (no hay `console.*` antes del `return`). Si la lógica falla, devuelven `500` con el mensaje.

### A.3 ¿Activos en el panel de Vercel? — **No verificable con este acceso**

- La API del conector de Vercel no expone los crons del proyecto, y el objeto del deployment de producción no los incluye.
- El CLI de Vercel no está instalado ni linkeado en esta máquina.
- **Pendiente para Luciano:** *Project → Settings → Cron Jobs*. ¿Aparecen los 4, habilitados?

## B. ¿Corrieron alguna vez?

### B.4–B.5 Logs de la plataforma — **no disponibles**

- El proyecto está en el **plan Hobby**. La consulta de logs de runtime con ventana de 24 h y de 7 días falla con *"Hobby retains 1 hour"*; la de 55 minutos funciona.
- Los crons corren entre las 03:00 y las 06:59 UTC (con la imprecisión de ±59 min de Hobby), así que **ninguna ejecución pasada es visible**.
- Además, un `401` del guard **no escribe log**: aunque hubiera retención, la única huella sería la línea de request de la plataforma.

### Evidencia en los datos — **concluyente sobre el "sí o no"**

Los snapshots de las purgas guardaron el estado anterior a borrar (`~/Desktop/Dev/first-blades-backups/`):

| Cron | Qué debió pasar | Qué pasó | Días seguidos sin una ejecución exitosa |
|---|---|---|---|
| `promote-estimated-days` | 19 filas con `es_estimado = true` y fechas del 01/08 al 11/09. La primera entró en la ventana de 7 días el **25/07** | Ninguna fue promovida (último `updated_at` de esas filas: 04/09). Y entre las 69 filas de los snapshots, **ninguna** que haya nacido fuera de la ventana de 7 días y después haya cambiado, que es la huella que dejaría una promoción | **73** (25/07 → 06/10) |
| `purge-rejected-docs` | Certificado rechazado el **24/06**. Debió purgarse desde el **25/07** (más de 30 días) | Archivo intacto hasta la purga manual de FB-PI-06; `file_purged_at` nulo | **74** (25/07 → 06/10) |

Un cron diario que falla **todos** los días durante más de dos meses no es un error intermitente: es una falla **sistemática y anterior a la lógica**.

## C. Hipótesis

| # | Hipótesis | Veredicto | Evidencia |
|---|---|---|---|
| 6 | **Límites del plan** | **Descartada** | Plan Hobby: 100 crons por proyecto, frecuencia mínima **diaria**, precisión ±59 min ([docs](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Los 4 son diarios. Una expresión incompatible **hace fallar el deploy**, y los deploys de producción están en `READY` |
| 7 | **`CRON_SECRET` ausente o distinta en Production** | **Candidata principal, no confirmada** | El guard devuelve `401` si falta. `GET /v10/projects/{id}/env` devolvió **403** a esta sesión. El repo solo **afirma** que existe (`FB-F3-07`: "ya existe como env var (de Fase 2)"); `.env.example` la lista vacía y `.env.local` no la tiene. Ningún informe de auditoría verificó su presencia en Vercel |
| 8 | **Rama o entorno** | **Descartada** | Los crons solo corren en deployments de Production. El deployment de producción vigente sale de `main` (`target: production`, `githubCommitRef: main`), con `vercel.json` presente desde la Fase 1 |
| 9a | **Fallo silencioso de la lógica** | **Descartada como causa** | `promote-estimated` usa `getBusinessToday()` (zona `America/Argentina/Buenos_Aires`, `lib/business-date.ts`), no UTC crudo, y lee el `{ error }` del `UPDATE` (lo convierte en `500`). Las dos lógicas que fallaron 73 y 74 días son triviales y no tienen dependencias externas fuera de Supabase |
| 9b | **Falta la service role en Production** | **Descartada** | Gestión de Usuarios y el alta de los 28 perfiles en producción usan `createAdminClient()`. La variable existe |
| — | **Redirect del middleware** (la guía de Vercel: "los crons no siguen redirects") | **Descartada** | `middleware.ts` excluye `pathname.startsWith('/api/')` de la redirección a `/login` |
| — | **Respuesta cacheada** | **Descartada** | Las rutas de cron leen `request.headers` y el build las marca dinámicas (`ƒ`) |
| — | **Crons no registrados o deshabilitados en el proyecto** | **Candidata secundaria, no confirmada** | Sin acceso al panel ni a la API de crons |

## D. Alcance del daño

| Cron | Qué dejó de pasar | Daño real hasta hoy |
|---|---|---|
| `promote-estimated-days` | Los días planificados no pasaron a reales a 7 días de la fecha | 19 filas quedaron mal marcadas como "planificadas", y con ellas el tono claro en la grilla y el `es_estimado` en las alertas. **Ya no quedan:** se fueron con las purgas, solo era dato de prueba |
| `purge-rejected-docs` | Los archivos rechazados no se borraron a los 30 días (retención de §5) | 1 archivo retenido de más. Lo borró FB-PI-06 |
| `document-expiry-alerts` | Mails de vencimiento a 30, 15 y 5 días | **Ninguna alerta perdida:** nunca hubo un documento aprobado dentro de la ventana. El único que vencía cerca (un estudio médico) se aprobó el mismo día de su vencimiento (24/06, 16:52 UTC) y ya estaba vencido en la primera corrida posible; los vencidos no alertan. Los 2 documentos actuales vencen dentro de 651 días o más |
| `franco-alerts` | Mails por rachas sin franco o con franco prolongado | **Ninguna alerta perdida:** con los datos que hubo, la racha máxima trabajando fue de 18 días (umbral 48) y la de franco de 6 (umbral 10) |

### D.11 Mails: confirmado y no confirmado

- **Confirmado:** hasta hoy **no se dejó de enviar ninguna alerta**, porque no hubo ninguna condición de disparo. `notification_log` vacía es **coherente con eso** y, como anticipaba el prompt, **no prueba nada por sí sola**.
- **No confirmado, y es el riesgo hacia adelante:** que el canal de mail funcione en producción. Los mails dependen de `GMAIL_SENDER_ADDRESS` y `GOOGLE_SERVICE_ACCOUNT_KEY_B64` (más `GMAIL_IMPERSONATED_USER`, opcional). Su presencia en Production **tampoco es verificable** con este acceso, y `CLAUDE.md` todavía lista *"Dirección de Gmail para notificaciones"* como **pendiente**. Si faltan, el runner atrapa el error, lo cuenta en `failed`, no registra y reintenta al día siguiente. **No es silencioso en el código** (`console.error`), pero con 1 hora de retención en Hobby **nadie lo vería**. Esto también alcanza a los mails de flujo que no son crons (rechazo de documento, resolución de ausencias y pasajes).
- **Con el historial cargado** el riesgo se vuelve concreto: 3 meses de calendario real van a producir rachas que **sí** cruzan los umbrales de franco.

## E. Cómo cerrar la causa (requiere a Luciano; nada se ejecutó)

**Opción 1, sin ejecutar nada:** que Luciano mire en el panel de Vercel:

1. *Project → Settings → Environment Variables*, filtro **Production**: ¿existen `CRON_SECRET`, `GMAIL_SENDER_ADDRESS` y `GOOGLE_SERVICE_ACCOUNT_KEY_B64`? Solo la presencia, no los valores.
2. *Project → Settings → Cron Jobs*: ¿aparecen los 4 y están habilitados?

**Opción 2, prueba sin escrituras, requiere autorización:** disparar a mano **`promote-estimated-days`** desde el panel (*Cron Jobs → Run*), que invoca con el header real de Vercel. Hoy `rotation_assignments` está **vacía**, así que el `UPDATE` afecta **0 filas: no escribe nada**. Inmediatamente después leo los logs de runtime, dentro de la hora de retención:

- `401` o ninguna línea del cron → **`CRON_SECRET` falta o no coincide** (causa 1);
- `[promote-estimated-cron] promoted=0` → la plataforma y el secreto funcionan, y la falla venía del registro o la habilitación (causa 2), o ya se corrigió;
- ninguna request registrada → el cron no está registrado (causa 2).

Los otros tres crons **no** se proponen para la prueba: `purge` borraría archivos si hubiera rechazados viejos, y los de alertas mandarían mails.

## F. Acciones que tocaron producción

Solo lecturas: API de Vercel (proyecto, equipo, deployment, logs de runtime de los últimos 55 minutos y un intento de listar variables de entorno, que devolvió `403`), una consulta `SELECT` a la base y la lectura local de los snapshots. **Ninguna escritura y ningún cron disparado.**

---

## G. Causa raíz confirmada y arreglo (FB-PI-10 / FB-PI-10-B)

### G.1 Causa raíz — confirmada

**`CRON_SECRET` no existía en Vercel** (confirmado por Luciano en el panel). Es la causa 1 de §C. Vercel disparaba los 4 crons según su schedule, pero solo manda `Authorization: Bearer <CRON_SECRET>` cuando la variable existe. Los endpoints fallan cerrado (`!cronSecret || authHeader !== …` → `401`) y respondían 401 sin ejecutar nada. Por eso hubo 73 días sin una sola ejecución exitosa, y el síntoma fueron datos viejos, no errores.

### G.2 Contrato verificado (Paso 0, antes de cargar el secreto)

- Los 4 `app/api/cron/*/route.ts` leen **solo** el header `Authorization` y lo comparan exacto contra `` `Bearer ${process.env.CRON_SECRET}` ``. Sin query params. Coincide con lo que manda Vercel. **Sin cambio de código.**
- Si falta la variable, **se rechaza todo** (401). No hay agujero de seguridad.
- `middleware.ts` excluye `/api/` del redirect a `/login`.
- `CRON_SECRET=` ya estaba en `.env.example`; se corrigió el comentario, que mencionaba solo la purga.

### G.3 Arreglo aplicado

| Paso | Quién | Resultado |
|---|---|---|
| Generar y cargar `CRON_SECRET` en **Production** (solo Production) | Luciano | Hecho. Claude Code nunca vio el valor |
| `rotation_assignments` antes de la prueba | Claude Code (`SELECT count(*)`) | **0 filas** (0 estimadas): la prueba no puede escribir nada |
| Redeploy de producción del deployment `dpl_FR1s2vmaKLQwNwXrVp22BBfau9vo` (commit `d8f8f06`, sin limpiar caché) | Claude Code (API de Vercel) | Nuevo deployment **`dpl_5y8kFbbHNKH5GNoKoQNWG8s6FJDN`**, `READY` el 06/10/2026 a las 19:19:31 ART, con alias `first-blades-app.vercel.app` |

### G.4 Verificación

- **Disparo manual de `promote-estimated-days`: HECHO.** Lo disparó Luciano desde *Cron Jobs → Run*, que manda el header real de Vercel. El panel mostró **200**. Leí los logs de runtime de Vercel a las 19:44 ART, dentro de la hora de retención:
  - **Timestamp:** `2026-10-06T22:42:51.525Z` (**19:42:51 ART**), `GET /api/cron/promote-estimated-days`, request `ckjkr-1791326570255-3d0a66f8ed4d`, deployment `dpl_5y8kFbbHNKH5GNoKoQNWG8s6FJDN`, región `iad1`.
  - **Salida:** `[promote-estimated-cron] promoted=0`. Era lo esperado con `rotation_assignments` en 0 filas: no se escribió nada.
  - **Código de respuesta:** los logs de runtime no traen el status HTTP. El 200 lo vio Luciano en el panel, y es coherente con el código: esa línea solo se imprime después de pasar la validación del secreto y de que el `UPDATE` no dé error, y la línea siguiente responde 200.
  - **Errores y advertencias:** ninguno. El filtro `error`/`warning`/`fatal` de la última hora vino vacío, y esa invocación fue la única request a `/api/cron/` de la ventana.
  - **Esto NO cierra el item.** Prueba que el endpoint responde cuando lo invocan con el secreto, **no** que Vercel lo invoque solo según el schedule. Acá fallaron las dos cosas por separado, y la segunda sigue sin verificar.
- **Los otros tres crons no se dispararon:** `purge-rejected-docs` puede borrar archivos, y los dos de alertas pueden mandar mails, que quedan fuera de alcance.

### G.5 Próximas ejecuciones nocturnas (schedules en UTC → hora argentina, UTC−3)

| Cron | Próxima ejecución |
|---|---|
| `purge-rejected-docs` — **corre primero** | mié 07/10/2026, **00:00 ART** |
| `document-expiry-alerts` | mié 07/10/2026, 01:00 ART |
| `promote-estimated-days` | mié 07/10/2026, 02:00 ART |
| `franco-alerts` | mié 07/10/2026, 03:00 ART |

**Ventana para mirar (importante):** en Hobby, el log de cada cron dura **1 hora desde su corrida**. Si se mira a la mañana del 07/10, **ya no va a quedar ninguno**. Las ventanas son: purga 00:00–01:00, alertas de vencimiento 01:00–02:00, **promoción 02:00–03:00** y alertas de franco 03:00–04:00 (hora argentina). Basta con alcanzar **una** de esas ventanas para confirmar que el schedule dispara. La más limpia es la de promoción (02:00–03:00 ART), porque no depende de los mails.

**Qué mirar:** en *Project → Settings → Cron Jobs*, abrir **View Logs** de cada cron (o *Logs*, filtrando por `/api/cron/`) y ver que haya una invocación cerca de cada hora con status **200**. No tiene que haber ningún 401. En los logs del cron de promoción tiene que aparecer la línea `[promote-estimated-cron] promoted=0`. **Ojo:** en Hobby los logs de runtime se guardan **1 hora**. Hay que mirarlos antes de que pase esa hora desde cada corrida, o usar la vista de Cron Jobs del panel si guarda el historial.

### G.6 Estado del item

Log `recQzoGnSvpEHfAYg`: **En curso.** Se cierra solo cuando haya **una ejecución nocturna automática exitosa**. Que el disparo manual funcione prueba la autenticación, no el schedule.

Los dos crons de alertas no van a poder mandar mails: la configuración de Gmail está fuera de alcance. Para esta verificación alcanza con que **no den 401**. Si alguno da 500 por el mail, se registra, pero no es una falla de este arreglo.
