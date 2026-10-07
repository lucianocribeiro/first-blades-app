# FB-PI-12 — Colapsar los controles de Exportar / Importar en Calendario

- **ID:** FB-PI-12
- **Fecha:** 14 de septiembre de 2026
- **Destino:** Claude Code
- **Guardar en:** `docs/prompts/FB-PI-12.md`
- **Constitución de referencia:** `docs/constitucion.md` **v0.8**
- **Migración:** ninguna.
- **Tipo:** ajuste de interfaz, rápido.

---

## Qué hay que hacer

Los controles de Exportar e Importar Excel ocupan espacio en la pantalla de Calendario, donde lo que el admin quiere ver es el calendario.

Meterlos en un **bloque colapsable**, con encabezado tipo "Importar / Exportar Excel", que se despliega al hacer clic.

Tres decisiones ya tomadas por Luciano:

1. **Bloque colapsable**, no un modal ni un panel lateral. Un modal taparía el calendario mientras se usa.
2. **Siempre arranca cerrado.** No recuerda el estado entre navegaciones ni entre sesiones. Es algo que se usa pocas veces; recordar el estado agrega complejidad sin beneficio.
3. **Solo admin.** Supervisor y empleado **no ven ni el bloque colapsado**, igual que hoy no ven los controles. El guard sigue siendo server-side; esconder en la UI no es el control.

---

## ⚠️ El riesgo real de este cambio

**Los e2e existentes del export y del import hacen clic en esos controles.** Si quedan detrás de un bloque cerrado, esos tests se rompen: el elemento ya no es visible al cargar la pantalla.

Actualizá los e2e para que abran el bloque antes de interactuar. **No los borres ni los marques como skip para que pase CI.** Si alguno no se puede adaptar, frená y reportá.

---

## Lo demás

- Copy del encabezado en es-AR, desde `/lib/copy`. Sin strings sueltos.
- Accesible: que se pueda abrir con teclado y que el estado abierto/cerrado se anuncie correctamente.
- Nada de la lógica de export ni de import cambia. Esto es solo dónde viven los controles.
- Clases de Tailwind literales, sin composición en runtime.

---

## Proceso — acortado por decisión de Luciano

**Sin auditoría de Codex.** Es un ajuste de interfaz, sin migración, sin cambios de datos y sin tocar permisos. Luciano decidió saltear ese paso para este item.

**Merge autorizado por adelantado, con una condición: CI verde en los tres jobs.** Esa compuerta no se saltea.

- Si CI queda verde: mergeá con **merge commit, nunca squash**, y reportá hash, CI sobre `main` y estado del deploy de Vercel. El deploy a producción sale solo con el merge a `main`; no hay `db push` porque no hay migración.
- **Si algún job queda en rojo: frená y reportá. No mergees.** La autorización cubre el escenario verde, no uno distinto.
- Si al hacerlo descubrís que el cambio toca más de lo previsto (lógica, permisos, esquema), frená y avisá: deja de ser el ajuste rápido que se autorizó.

---

## Fuera de alcance

- Cualquier cambio a la lógica de export o import.
- Rediseño del resto de la pantalla de Calendario.
- Las nueve funciones con la guarda vulnerable a NULL (`recfamWK93drsaCiQ`).
- Los dos cambios pendientes a la constitución.

---

## Definición de Done

- [ ] Bloque colapsable, cerrado por defecto, solo admin.
- [ ] e2e actualizados para abrir el bloque, ninguno borrado ni en skip.
- [ ] Copy es-AR desde `/lib/copy`. Accesible por teclado.
- [ ] CI verde en los tres jobs, reportado por job.
- [ ] Mergeado con merge commit y deploy reportado.
- [ ] Este prompt guardado en `docs/prompts/FB-PI-12.md`.
