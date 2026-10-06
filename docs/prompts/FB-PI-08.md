# FB-PI-08 — Diagnóstico: los crons de Vercel no estarían corriendo en producción

- **ID:** FB-PI-08
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-08.md`
- **Origen:** Log de Airtable `recQzoGnSvpEHfAYg` (Bug, **Alta**)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración esperada:** ninguna.
- **Prioridad:** va **antes** del import de calendario y antes de cargar el historial de 3 meses. Decisión de Luciano.

---

## Por qué esto va primero

Cargar tres meses de historial sobre una app cuyos crons no corren significa que ese historial no va a consolidar sus días estimados y no va a disparar las alertas que corresponden. Se arregla la cañería antes de llenarla.

Y hay un agravante de oportunidad: las purgas `FB-PI-06` y `FB-PI-07` **se llevaron las 19 filas que eran el síntoma visible**. `rotation_assignments` está hoy en cero. Si esto no se diagnostica ahora, el próximo indicio recién va a aparecer semanas después de cargar el historial, mezclado con datos reales.

---

## Tres señales

1. **Consolidación de `es_estimado`.** §5 define un cron nocturno que pasa `es_estimado` a `false` cuando la fecha entra en la ventana de 7 días. Había 19 filas con fecha pasada —del 01/08 al 11/09— todavía marcadas como estimadas, es decir bastante dentro de la ventana que el cron debería haber procesado. Último `updated_at` de la tabla: 04/09.
2. **Purga de documentos rechazados.** §5 fija retención de 30 días. Detectado en el preflight de `FB-PI-06`: el archivo de un certificado rechazado seguía en Storage bastante más de 30 días después del rechazo.
3. **`notification_log` vacía.** Cero registros, nunca. **Esta señal es la más débil y hay que tratarla como tal:** también sería compatible con que ninguna condición de alerta se haya cumplido jamás, algo verosímil con solo 69 días de calendario de prueba para 4 personas. No la uses como prueba; usala como coherencia con las otras dos.

---

## Paso 0 — Diagnóstico (⛔ solo lectura, con informe versionado)

**No arregles nada en este paso.** El objetivo es saber qué está pasando, no taparlo.

Averiguá, en este orden:

### A. ¿Los crons existen y están configurados?

1. Qué crons están declarados en `vercel.json` (o donde corresponda): rutas, schedules, cuántos.
2. Qué endpoints implementan esas rutas y qué hacen.
3. **¿Aparecen en el panel de Vercel del proyecto como cron jobs activos?** Estar en el archivo no garantiza estar activo.

### B. ¿Corrieron alguna vez?

4. Última ejecución de cada cron según Vercel: fecha, duración, código de respuesta.
5. Logs de esas ejecuciones. Si hay ejecuciones con respuesta 401 o 403, **el cron corrió pero el endpoint lo rechazó**, que es un modo de falla distinto y muy común.

### C. Hipótesis a descartar explícitamente

6. **Límites del plan de Vercel.** Según el plan, puede haber topes de cantidad de crons y de frecuencia. Verificá en qué plan está el proyecto y si los schedules declarados son compatibles.
7. **Secreto del cron.** Si los endpoints se protegen con un `CRON_SECRET` o equivalente y esa variable de entorno **no está en producción**, el cron se dispara y recibe 401 sin hacer nada. Verificá que la variable exista en el entorno de producción, sin imprimir su valor.
8. **Rama o entorno.** Que los crons apunten al deployment de producción y no a otro.
9. **Fallo silencioso dentro del endpoint.** Si corre con 200 pero no escribe, el problema es la lógica, no la plataforma. Para la consolidación: ¿el cálculo de "hoy" usa `getBusinessToday` en zona `America/Argentina/Buenos_Aires` o UTC crudo? ¿La escritura lee el `{ error }` de PostgREST como valor (§2.5)?

### D. Alcance del daño

10. **Lista completa de los crons del proyecto** y, para cada uno, qué dejó de pasar si no corrió: consolidación de `es_estimado`, purga de documentos rechazados a 30 días, alertas de franco por mail, vencimiento de documentos por mail, y cualquier otro.
11. **El impacto sobre los mails es lo más grave y es el que hay que confirmar o descartar.** Un mail que no se envía no genera error en ningún lado: el cliente puede no estar recibiendo ninguna alerta desde hace meses sin que nadie lo note.

**Entregable:** `docs/audits/FB-PI-08-DIAG.md`, commiteado, con una respuesta clara a: **¿corren los crons, sí o no?** Y si no corren, **por qué**. Si hay más de una causa, listalas todas.

**Frená acá.** Con el diagnóstico en la mano se decide el arreglo, que va en un prompt aparte.

---

## Restricciones

- **Solo lectura en producción.** Nada de escrituras, nada de disparar crons a mano sin autorización.
- Si para confirmar algo hiciera falta ejecutar un cron manualmente, **pedí autorización antes**, explicando qué va a escribir.
- Sin secretos en el informe: confirmá que una variable existe, nunca imprimas su valor.
- Reportá cualquier acción que toque producción (§2.3).

---

## Fuera de alcance

- El arreglo. Primero el diagnóstico.
- Recrear a mano los datos que los crons no procesaron.
- El import de calendario y la carga del historial.
- Los merges pendientes de los PRs de documentación #53 y #54.

---

## Definición de Done

- [ ] `docs/audits/FB-PI-08-DIAG.md` commiteado, con respuesta clara a "¿corren, sí o no?" y la causa.
- [ ] Inventario completo de los crons del proyecto y qué dejó de pasar con cada uno.
- [ ] Hipótesis de plan, secreto, entorno y fallo silencioso: cada una confirmada o descartada con evidencia.
- [ ] Impacto sobre los mails confirmado o descartado.
- [ ] Solo lecturas en producción, o escrituras autorizadas explícitamente y reportadas.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-08.md`.
