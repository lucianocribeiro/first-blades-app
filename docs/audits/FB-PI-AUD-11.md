```text
HALLAZGO 1 — La guarda de la RPC permite un `is_admin()` NULL para sesiones autenticadas sin perfil
Severidad: Bloqueante
Archivo:supabase/migrations/0022_import_calendario.sql:104-110
Qué: `auth.uid() IS NULL OR NOT public.is_admin()` permite pasar cuando `is_admin()` devuelve NULL para un JWT autenticado sin perfil.
Por qué: Incumple §6.1 y §12.6: NULL debe tratarse como no-admin. En una función SECURITY DEFINER permite importar y auditar sin ser administrador.
Sugerencia: Evaluar explícitamente `is_admin()` como TRUE y agregar un test con JWT authenticated sin perfil.

HALLAZGO 2 — La RPC no vuelve a validar la ventana razonable de fechas
Severidad: Mayor
Archivo:supabase/migrations/0022_import_calendario.sql:144-169
Qué: Solo valida el máximo de 366 días; no aplica el límite `2020-01-01` a hoy + 2 años que sí valida la app.
Por qué: La RPC es el control autoritativo de escritura y debe repetir la validación server-side.
Sugerencia: Validar ambos límites dentro de la RPC y agregar tests de integración.

HALLAZGO 3 — La previsualización deja días afectados fuera del listado obligatorio
Severidad: Mayor
Archivo:app/(app)/calendario/import-actions.ts:51-53,158,184-185
Qué: `borrados` y `pisados` se limitan a 500 elementos, aunque los conteos son completos y no se informa el truncado.
Por qué: El PRD exige listar uno por uno los días pisados y permitir revisar todos los impactos antes de confirmar.
Sugerencia: Mostrar la lista completa o incorporar paginación/expansión obligatoria.

HALLAZGO 4 — El test que protege contra 40001 solo detecta una forma textual
Severidad: Menor
Archivo:tests/integration/migration.test.ts:1371-1379
Qué: Solo prohíbe `ERRCODE = '40`; no detectaría una reintroducción equivalente con otra sintaxis válida.
Por qué: El test debe fallar ante cualquier reintroducción de 40001 o de otro código de clase 40.
Sugerencia: Hacer la comprobación independiente de la sintaxis y ejercitar la ruta de aborto.

HALLAZGO 5 — El chequeo de duplicado del alta no usa la misma normalización del índice
Severidad: Mayor
Archivo:app/(app)/gestion-usuarios/actions.ts:38-55,78-88
Qué: El índice usa `lower(btrim(email))`, pero `createUser()` busca con `ilike` sin recortar el valor almacenado. Una colisión puede terminar mostrando un error crudo de base.
Por qué: Incumple el comportamiento aprobado: la alta debe devolver copy es-AR ante una colisión normalizada.
Sugerencia: Usar exactamente la clave normalizada del índice y mapear colisiones de unicidad a `emailDuplicado`.
```

---

> **Nota del Developer — triage (FB-PI-11-C):** 5 hallazgos: **1 bloqueante, 3 mayores y 1 menor**. **Los cinco se corrigieron en este mismo PR (#56) antes del `db push`**, ninguno se difirió al Log. Commit `a2a358c`, CI verde en los tres jobs. Detalle de cada corrección en `docs/audits/FB-PI-11-SCHEMA-PREPUSH.md` §7.
>
> Como se trata de una migración, queda **pendiente la re-auditoría** (§1.1). Su informe se versionará igual que este, verbatim y en bloque de código.
>
> **Hallazgo 1, fuera de 0022:** el mismo patrón de guarda por negación está en 9 funciones ya en producción (0013–0020). **Decisión de Luciano (FB-PI-11-D):** van en una **migración separada, después de cerrar el import**, no dentro de 0022. Hoy no es explotable: 27 usuarios de Auth y 27 perfiles, sin huérfanos. Está cargado como **Alta** en el Log (`recfamWK93drsaCiQ`).
