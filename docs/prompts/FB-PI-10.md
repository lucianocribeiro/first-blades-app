# FB-PI-10 — Arreglo: cargar `CRON_SECRET` y verificar que los crons corran

- **ID:** FB-PI-10
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-10.md`
- **Continúa:** `FB-PI-08` (diagnóstico, PR #55)
- **Origen:** Log de Airtable `recQzoGnSvpEHfAYg` (Bug, Alta)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.

---

## Causa raíz confirmada

**No existe la variable de entorno `CRON_SECRET` en Vercel.** Confirmado por Luciano en el panel.

Mecanismo: Vercel dispara los 4 crons según su schedule, los endpoints validan contra `CRON_SECRET`, y al no existir responden 401 sin ejecutar nada ni dejar log. Desde afuera el cron "corre" puntualmente todas las noches y no hace nada. Por eso el síntoma fueron datos viejos y no errores. 73 días sin una sola ejecución exitosa.

---

## Alcance de este prompt

**Solo el secreto del cron.** Los mails quedan para un trabajo aparte: hoy no están configurados y ésa es otra conversación. Decisión de Luciano.

---

## Paso 0 — Verificación del contrato de autenticación ⛔

**Antes de que Luciano cargue nada**, confirmá exactamente qué esperan los endpoints, porque si el formato no coincide el secreto va a estar cargado y los crons van a seguir en 401.

1. **Qué header y qué formato valida cada uno de los 4 endpoints.** Vercel envía `Authorization: Bearer <CRON_SECRET>` cuando esa variable existe en el proyecto. Confirmá que los endpoints validen exactamente eso, y no otro header o un query param.
2. **Qué pasa si la variable no existe**, en el código: ¿rechaza todo, o deja pasar? Si dejara pasar, sería un agujero aparte y hay que decirlo.
3. **Nombre exacto de la variable** que leen, carácter por carácter.
4. **¿Está en `.env.example`?** Si no, agregala ahí, sin valor.
5. Los 4 crons, sus rutas y sus schedules, para la verificación posterior.

**Entregable:** reportá esto antes de que Luciano toque Vercel. Si el formato no es el que Vercel manda, decilo ahora: puede necesitar un cambio de código y eso cambia el plan.

---

## Paso 1 — Carga del secreto (lo hace Luciano)

**Claude Code no genera, no ve y no recibe este valor.** Un secreto que pasa por un chat deja de ser secreto.

Luciano:
1. Genera un valor aleatorio largo.
2. Lo carga en Vercel como `CRON_SECRET`, con el entorno **Production** tildado.
3. Confirma que quedó cargado.

Claude Code: indicá si además conviene tildar Preview y Development, y por qué, pero **no pidas el valor nunca**.

---

## Paso 2 — Redeploy

**Las variables de entorno no toman efecto en los deployments ya existentes.** Sin un deployment nuevo, el secreto está cargado y los crons siguen dando 401.

Decí cuál es la forma correcta de forzar el redeploy de producción en este proyecto, y ejecutala si está dentro de tu alcance. **Reportá esta acción: toca producción** (§2.3).

---

## Paso 3 — Verificación

El calendario está **vacío** tras las purgas, así que hay una prueba segura disponible:

1. **Disparar a mano `promote-estimated-days`.** Con `rotation_assignments` en cero, no puede modificar ninguna fila. Es una prueba que no escribe nada.
2. Leer el resultado:
   - **401** → el secreto todavía no llega bien. Frená y reportá; no sigas tocando.
   - **200 con 0 promovidos** → la autenticación funciona. Es el resultado esperado con el calendario vacío.
3. **No dispares los otros tres**: la purga podría borrar archivos y los de alertas podrían intentar mandar mails, que es justo lo que está fuera de alcance.
4. Confirmá que los 4 crons aparezcan habilitados y con su próxima ejecución programada.
5. Dejá anotada la fecha y hora de la próxima ejecución nocturna, para que Luciano pueda confirmar al día siguiente que corrió de verdad y no solo a mano.

---

## Paso 4 — Registro

- Actualizá `docs/audits/FB-PI-08-DIAG.md` con la causa raíz confirmada y el resultado del arreglo.
- Si el PR #55 todavía está abierto, sumá esto ahí en vez de abrir otro.
- **No cierres el item del Log hasta que haya una ejecución nocturna exitosa**, no solo una manual. Que el disparo manual funcione no prueba que el schedule funcione.

---

## Fuera de alcance

- **Todo lo de mails:** `GMAIL_SENDER_ADDRESS`, `GOOGLE_SERVICE_ACCOUNT_KEY_B64` y los dos crons de alertas. Trabajo aparte.
- El plan de Vercel.
- El import de calendario y la carga del historial.
- Recrear a mano los datos que los crons no procesaron: el calendario está vacío, no hay nada que recuperar.

---

## Definición de Done

- [ ] Contrato de autenticación verificado y reportado **antes** de cargar el secreto.
- [ ] `CRON_SECRET` en `.env.example`, sin valor.
- [ ] Secreto cargado por Luciano en Production. Claude Code nunca lo vio.
- [ ] Redeploy de producción hecho y reportado.
- [ ] `promote-estimated-days` disparado a mano devuelve 200.
- [ ] Los 4 crons habilitados, con próxima ejecución anotada.
- [ ] Registro actualizado en `docs/audits/FB-PI-08-DIAG.md`.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-10.md`.

**El item no se cierra hasta que corra solo de noche.**
