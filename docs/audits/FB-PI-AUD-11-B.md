```text
HALLAZGO 1 — Falta una prueba de integración del tope de 366 días en la RPC
Severidad: Menor
Archivo:tests/integration/calendario-import.test.ts:532-554
Qué: La migración implementa `v_hasta - v_desde + 1 > 366` con `22023`, pero el bloque DB-backed solo invoca la RPC para las fechas anteriores a 2020 y posteriores a hoy + 2 años, además de los bordes válidos de esa ventana. No hay una llamada a la RPC con un rango de 367 días. El caso existente en `tests/unit/calendario-import.test.ts:262-266` solo prueba la validación de la aplicación.
Por qué: FB-PI-AUD-11-B §4-§6 y FB-PI-11-C exigen proteger mediante integración los límites de la validación autoritativa de la RPC. Si se elimina o rompe la validación SQL de 366 días, la suite DB-backed podría seguir verde aunque la RPC acepte un lote fuera del límite.
Sugerencia: Agregar un test DB-backed que invoque `importar_calendario` por REST o conexión directa con fechas dentro de la ventana temporal pero separadas por 367 días, espere `22023` y verifique que no se escriben filas.
```

---

> **Nota del Developer — triage (FB-PI-11-E):** la re-auditoría devolvió **un hallazgo único, severidad Menor**: faltaba un test de integración del tope de 366 días de la RPC. **Se resolvió con un test en el mismo PR (#56)**, en `tests/integration/calendario-import.test.ts`:
>
> - **367 días** dentro de la ventana válida → `22023`, ninguna fila escrita, ninguna entrada de auditoría.
> - **Borde válido de 366 días exactos** → se escriben las dos filas.
>
> Se verificó que el test **se pone rojo si se saca la validación SQL**, con una corrida en CI de un mutante de la función sin el tope (PR temporal #57, cerrado y con la rama borrada).
>
> **Sin tercera re-auditoría:** la corrección no toca la migración ni el código de la función, solo agrega cobertura (mismo criterio que el borde de 1001 filas en FB-PI-05).
