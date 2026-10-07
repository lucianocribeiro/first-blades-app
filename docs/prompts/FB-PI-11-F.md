# FB-PI-11-F — `db push` de la migración 0022, ejecutado por Claude Code

- **ID:** FB-PI-11-F
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11-F.md`
- **Continúa:** `FB-PI-11-E` (re-auditoría limpia, CI verde en `8e732ed`, PR #56)
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** 0022. **Esto la aplica a producción.**

---

## Cambio de regla del proyecto

Hasta ahora el `supabase db push` lo corría Luciano a mano. **A partir de ahora lo ejecuta Claude Code**, en ésta y en todas las migraciones futuras.

Decisión de Luciano, y el motivo importa para entender qué cambia y qué no: **una sola mano operando el repositorio y la base.** Dos manos producen estados raros, que es exactamente lo que pasó en Fase 3 cuando la 0012 llegó a producción por un camino paralelo (§2.3).

**Lo que NO cambia: el gate sigue existiendo.** §2.3 nunca pidió que tipeara Luciano; pidió que todo `db push` pase por el runbook gateado, o sea que haya una pausa deliberada entre el plan y la escritura en producción. Esa pausa ahora es **la autorización explícita de Luciano en el momento**, igual que en las purgas `FB-PI-06` y `FB-PI-07`.

Traducción práctica: **vos ejecutás, Luciano autoriza, paso por paso.** La autorización de un paso no autoriza el siguiente.

Al cerrar el item, esta regla hay que registrarla en la constitución §2.3.

---

## Paso 0 — Compuertas previas ⛔ (solo lectura, frená y reportá)

**No ejecutes el push en este paso.** Corré las verificaciones y entregá el reporte.

1. **Query de duplicados de email** en producción. Si devuelve **alguna fila**, frená: el índice único no se puede crear y hay que resolver eso antes. La verificación de ayer no sirve como compuerta: rehacela ahora.
2. **`supabase migration list`**: producción tiene que estar en **0021**. Si está en otra cosa, frená y reportá.
3. **`supabase db push --dry-run`**: tiene que listar **solo la 0022**. Si lista cualquier otra cosa, frená y reportá — significa que hay drift entre la branch y producción.
4. Confirmá que estás parado en el branch correcto del PR #56, en la cabeza con CI verde.

**Entregá los cuatro resultados y esperá la autorización de Luciano.** No sigas al Paso 1 sin ella.

---

## Paso 1 — `db push` (solo con autorización explícita)

- Ejecutá `supabase db push`.
- **Entregá la salida completa, sin resumir.**
- **Reportá que esto tocó producción** (§2.3).

Si falla a mitad: la CLI aplica cada archivo dentro de una transacción y la 0022 no tiene nada que corra fuera de una, así que un fallo revierte el archivo entero y producción queda en 0021. **Aun así, no lo asumas:** corré las queries del runbook para confirmar el estado real antes de decir nada. Si falló, frená y reportá; no reintentes por tu cuenta.

---

## Paso 2 — Verificación de catálogo (solo lectura)

Corré las queries a–g del runbook y reportá cada resultado contra su valor esperado:

- `owner`, `prosecdef`, `proconfig` y `proacl` de la función nueva.
- Privilegios efectivos: `EXECUTE` solo a `authenticated`, **sin `anon` ni `PUBLIC`**. Supabase re-otorga a `anon` por default, así que esto es lo que confirma que el `REVOKE` quedó aplicado.
- La guarda de admin corregida.
- La definición del índice único.
- Que no cambiaron datos.

**Cualquier desvío respecto de lo esperado: frená y reportá.** No lo corrijas por tu cuenta — un arreglo improvisado sobre producción es peor que el desvío.

---

## Paso 3 — Cierre del runbook

- `supabase migration list`: **Local = Remote**, con 0001–0022.
- **Regen de `types.ts --linked`, siempre**, aunque el diff sea de infraestructura. Si hay diff, se commitea: el archivo regenerado es la fuente de verdad, y mantenerlo al día es lo que hace que el diff cero siga siendo señal confiable de drift (§2.3).
- CI verde en los tres jobs sobre la cabeza final.

---

## Paso 4 — Merge

**Solo con autorización explícita de Luciano**, que es un paso distinto del que autorizó el push.

- Merge commit, nunca squash.
- Reportá hash, CI sobre `main` y estado del deploy de Vercel.

---

## Fuera de alcance

- **Cargar el historial de 3 meses.** Lo hace Luciano desde la app, después del merge.
- Las nueve funciones con la guarda vulnerable a NULL (`recfamWK93drsaCiQ`): migración separada, después de cerrar el import.
- Configuración de Gmail.
- El PR #26 de Fase 4.

---

## Definición de Done

- [ ] Las cuatro compuertas del Paso 0 reportadas **antes** del push.
- [ ] Push autorizado explícitamente y ejecutado, con la salida completa reportada.
- [ ] Verificación de catálogo a–g, cada una contra su valor esperado.
- [ ] `migration list` Local = Remote con 0001–0022.
- [ ] `types.ts` regenerado; si hay diff, commiteado.
- [ ] CI verde en los tres jobs.
- [ ] Merge autorizado por separado y ejecutado con merge commit.
- [ ] Deploy a producción reportado.
- [ ] Nueva regla de ejecución del `db push` anotada para llevar a la constitución §2.3.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11-F.md`.

**Cada paso que toque producción requiere autorización explícita de Luciano. La autorización de un paso no autoriza el siguiente.**
