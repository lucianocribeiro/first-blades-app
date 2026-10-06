# FB-PI-10-C — Resultado de la prueba manual: 200. Cierre parcial del arreglo del cron

- **ID:** FB-PI-10-C
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-10-C.md`
- **Continúa:** `FB-PI-10-B` (redeploy hecho, PR #55)
- **Origen:** Log de Airtable `recQzoGnSvpEHfAYg` (Bug, Alta)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Resultado de la prueba

Luciano disparó a mano `promote-estimated-days` desde Cron Jobs → Run en el panel de Vercel.

**Resultado: 200.**

Es el resultado esperado. La autenticación funciona: el `CRON_SECRET` está cargado en Production, el redeploy lo tomó, y los endpoints lo validan correctamente. **Causa raíz cerrada.**

Los otros tres crons no se dispararon.

---

## Paso 1 — Leer los logs ahora ⛔ (hay ventana de tiempo)

El plan es Hobby y **los logs duran 1 hora**. Esto es lo primero, antes que cualquier otra cosa.

Leé los logs de esa invocación y dejá registrado:

- Código de respuesta y timestamp exacto.
- Cantidad de días promovidos. Con `rotation_assignments` en cero, lo esperado es **0**. Si fuera distinto de 0, **frená y reportá**: significa que la tabla no estaba vacía y algo cambió desde las purgas.
- Cualquier error o advertencia en la salida, aunque la respuesta sea 200.

Si los logs ya expiraron, decilo con todas las letras en vez de dar por supuesto lo que decían.

---

## Paso 2 — Registro

En `docs/audits/FB-PI-08-DIAG.md`, sección G:

- Marcá la verificación manual como **hecha**, con el resultado y el timestamp.
- Dejá explícito que **esto NO cierra el item**: prueba que el endpoint responde cuando lo invocan, no que Vercel lo invoque según el schedule. Acá fallaron las dos cosas por separado.
- Dejá anotado qué tiene que mirar Luciano mañana y a qué hora, en hora argentina.

Commiteá al **PR #55**, sin abrir otro. Reportá CI por job.

---

## Paso 3 — Qué queda pendiente

**El item del Log sigue En curso.** La confirmación que falta es una **corrida nocturna automática exitosa**.

Corridas de esta noche, hora argentina: `purge-rejected-docs` 00:00, `document-expiry-alerts` 01:00, `promote-estimated-days` 02:00, `franco-alerts` 03:00.

Los dos crons de alertas no van a poder enviar mails porque la configuración de Gmail está fuera de alcance. Para esta verificación alcanza con que **no den 401**. Si alguno diera 500 por el mail, decilo pero no lo trates como falla de este arreglo.

---

## Fuera de alcance

- Todo lo de mails: `GMAIL_SENDER_ADDRESS`, `GOOGLE_SERVICE_ACCOUNT_KEY_B64` y los dos crons de alertas.
- Disparar a mano los otros tres crons.
- El plan de Vercel.
- El import de calendario y la carga del historial.
- El PR #26 de Fase 4.

---

## Definición de Done

- [ ] Logs de la invocación leídos y registrados, o declarado explícitamente que expiraron.
- [ ] Días promovidos = 0 confirmado. Si no, frenado y reportado.
- [ ] `docs/audits/FB-PI-08-DIAG.md` §G actualizado en el PR #55, con CI reportado.
- [ ] Anotado qué mirar mañana y a qué hora.
- [ ] Item del Log declarado **En curso**, no resuelto.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-10-C.md`.

**El merge del PR #55 lo autoriza Luciano, sin excepción.**
