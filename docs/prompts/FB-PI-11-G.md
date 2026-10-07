# FB-PI-11-G — Reporte del `db push` y verificación de catálogo, antes del merge

- **ID:** FB-PI-11-G
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-11-G.md`
- **Continúa:** `FB-PI-11-F` (compuertas verdes, push presuntamente ejecutado) · PR #56
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** 0022.

---

## Por qué este prompt

El último reporte saltó de las cuatro compuertas del Paso 0 a "CI verde sobre `cf42147`, runbook cerrado". **Faltan tres entregables intermedios que `FB-PI-11-F` pedía explícitamente**, y que son justamente los que tocan producción:

- La salida del `supabase db push`.
- La verificación de catálogo a–g.
- El `migration list` final.

Que el `types.ts` se haya regenerado sugiere que el push corrió, pero **no lo doy por hecho ni por bueno sin ver los resultados.**

**No es trámite.** La verificación de catálogo es lo único que confirma que el `REVOKE` de `anon` y `PUBLIC` se aplicó de verdad. Supabase **re-otorga `EXECUTE` a `anon` por default**: si ese `REVOKE` no quedó, hay una función `SECURITY DEFINER` invocable por usuarios anónimos en producción, y nadie se enteraría hasta que alguien la invoque. Por eso §2.3 la exige y por eso va antes del merge, no después.

**No mergees hasta entregar esto.**

---

## Lo que necesito, en este orden

### 1. Salida completa del `supabase db push`

Sin resumir y sin reformatear. Si el push no se ejecutó, **decilo con todas las letras** en vez de reconstruirlo: es información distinta y cambia todo lo que sigue.

Indicá también fecha y hora, y confirmá que esto tocó producción (§2.3).

### 2. Verificación de catálogo a–g

Las queries del runbook, cada resultado contra su valor esperado. Como mínimo:

- `owner` de la función nueva: rol de administración, no un rol de app.
- `prosecdef`: la función es `SECURITY DEFINER`.
- `proconfig`: `search_path` fijo explícito.
- `proacl` y privilegios efectivos: **`EXECUTE` solo a `authenticated`, sin `anon` y sin `PUBLIC`.** Éste es el crítico.
- La guarda de admin corregida, con evaluación afirmativa de `is_admin()`.
- La definición del índice único de email.
- Que no cambiaron datos.

Si alguna no coincide con lo esperado, **frená y reportá. No la corrijas por tu cuenta.** Un arreglo improvisado sobre producción es peor que el desvío.

### 3. `supabase migration list`

Local = Remote, con 0001–0022.

### 4. Estado del `types.ts`

Si el regen dio diff, cuál fue y si quedó commiteado. Si dio diff cero, decilo.

---

## Después, y solo si los cuatro dan lo esperado

Pedile a Luciano la autorización de merge. **Es una autorización distinta de la del push**, y no la tenés todavía.

Con ella: marcar el PR #56 como listo, mergear con **merge commit, nunca squash**, y reportar hash, CI sobre `main` y estado del deploy de Vercel.

---

## Fuera de alcance

- Cargar el historial de 3 meses: lo hace Luciano desde la app, después del merge.
- Las nueve funciones con la guarda vulnerable a NULL (`recfamWK93drsaCiQ`).
- Registrar la regla de §2.3 y la excepción del `audit_log` en la constitución: van en su propio trabajo, después de cerrar éste.
- Configuración de Gmail.

---

## Definición de Done

- [ ] Salida completa del `db push` entregada, o declarado explícitamente que no se ejecutó.
- [ ] Verificación de catálogo a–g, cada resultado contra su valor esperado.
- [ ] `EXECUTE` sin `anon` ni `PUBLIC`, confirmado explícitamente.
- [ ] `migration list` Local = Remote con 0001–0022.
- [ ] Estado del `types.ts` reportado.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-11-G.md`.

**No se mergea hasta que esto esté entregado y Luciano autorice el merge por separado.**
