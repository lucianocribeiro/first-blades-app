# FB-PI-10-B — Redeploy y verificación del `CRON_SECRET`

- **ID:** FB-PI-10-B
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-10-B.md`
- **Continúa:** `FB-PI-10`, Paso 0 entregado y aprobado (commit `b67beb0` en el PR #55)
- **Origen:** Log de Airtable `recQzoGnSvpEHfAYg` (Bug, Alta)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Estado

**El `CRON_SECRET` ya está cargado en Vercel, solo en el entorno Production.** Lo generó y lo cargó Luciano. Claude Code no lo vio ni lo va a ver: no pidas el valor en ningún momento, ni para verificar, ni para comparar.

El Paso 0 quedó aprobado: los 4 endpoints leen el header `Authorization` y lo comparan exacto contra `Bearer ${CRON_SECRET}`, que es lo que Vercel envía. **No hay cambio de código que hacer.**

---

## Paso 1 — Redeploy de producción

Las variables de entorno no toman efecto en los deployments existentes. Sin un deployment nuevo, el secreto está cargado y los crons siguen respondiendo 401.

- Ejecutá el redeploy del deployment de producción actual, sin limpiar el caché de build.
- **Esto toca producción: reportalo** (§2.3), con el id del deployment y su resultado.
- Si el redeploy falla o queda en un estado raro, **frená y reportá**. No improvises.

---

## Paso 2 — Verificación con la prueba segura

1. **Antes de disparar nada, confirmá que `rotation_assignments` sigue en cero filas.** Es lo que hace que esta prueba no escriba nada. Si no está en cero, frená y reportá: algo cambió desde las purgas.
2. Disparar a mano **solo** `promote-estimated-days`.
3. Interpretá el resultado:
   - **401** → el secreto todavía no llega bien. Frená y reportá. No toques variables de entorno ni código por tu cuenta.
   - **200 con 0 promovidos** → la autenticación funciona. Es el resultado esperado con el calendario vacío.
4. **No dispares los otros tres.** `purge-rejected-docs` podría borrar archivos, y los dos de alertas podrían intentar enviar mails, que está fuera de alcance.
5. Confirmá que los 4 crons figuren habilitados, con su próxima ejecución programada, y anotá fecha y hora de cada una en hora argentina.

---

## Paso 3 — Registro

- Actualizá `docs/audits/FB-PI-08-DIAG.md` con la causa raíz confirmada, el arreglo aplicado y el resultado de la prueba.
- Sumalo al **PR #55**, sin abrir otro.
- Reportá el estado de CI del PR por job.

---

## ⛔ El item NO se cierra todavía

Que el disparo manual devuelva 200 prueba que la autenticación funciona. **No prueba que el schedule se dispare.** Acá fallaron las dos cosas por separado y hay que verificar las dos.

La confirmación pendiente es que **una ejecución nocturna automática** haya corrido con éxito. Los crons corren entre las 00:00 y las 03:00 hora argentina.

En tu reporte, dejá explícito:

- Qué cron corre primero y a qué hora argentina.
- Qué tiene que mirar Luciano al día siguiente para confirmar que corrió solo.
- Que el item del Log queda **En curso** hasta esa confirmación.

---

## Fuera de alcance

- Todo lo de mails: `GMAIL_SENDER_ADDRESS`, `GOOGLE_SERVICE_ACCOUNT_KEY_B64` y los dos crons de alertas. Trabajo aparte.
- El plan de Vercel.
- La comparación de secreto en tiempo no constante: evaluada y descartada, no es riesgo práctico con 64 caracteres hex. No la anotes en el Log ni la cambies.
- El import de calendario y la carga del historial.
- El PR #26 de Fase 4.

---

## Definición de Done

- [ ] Redeploy de producción ejecutado y reportado, con id de deployment.
- [ ] `rotation_assignments` confirmada en cero **antes** de la prueba.
- [ ] `promote-estimated-days` disparado a mano devuelve 200 con 0 promovidos.
- [ ] Los otros tres crons **no** disparados.
- [ ] Los 4 crons habilitados, con próxima ejecución en hora argentina.
- [ ] `docs/audits/FB-PI-08-DIAG.md` actualizado en el PR #55, con CI reportado.
- [ ] Indicado qué tiene que mirar Luciano al día siguiente.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-10-B.md`.

**El merge del PR #55 lo autoriza Luciano, sin excepción.**
