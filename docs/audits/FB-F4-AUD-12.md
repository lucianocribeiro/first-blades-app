# FB-F4-AUD-12

## Hallazgo

Bajo - cobertura de UI incompleta para `{ok:false}` en algunos call sites.

Ubicación: tests de UI de los call sites, especialmente [solicitud-ausencia-form.test.tsx (line 13)](/Users/lucianocr/Desktop/Dev/first-blades-app/tests/unit/solicitud-ausencia-form.test.tsx:13), SolicitudPasajeForm y AprobacionesTable.

Evidencia: la implementación sí maneja `!ok` y muestra el error en [AprobacionesTable.tsx](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/aprobaciones/AprobacionesTable.tsx:287), [SolicitudAusenciaForm.tsx](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-ausencia/SolicitudAusenciaForm.tsx:79) y [SolicitudPasajeForm.tsx](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/solicitud-pasaje/SolicitudPasajeForm.tsx:99). Pero los tests unitarios cubren sobre todo las actions devolviendo `{ok:false}`; el test de formulario de ausencia sólo actualiza el mock a `{ok:true}`. El e2e cubre el caso crítico de producción para solapamiento en ausencia y verifica que no aparece el error redactado de Next en [solicitudes.spec.ts (line 33)](/Users/lucianocr/Desktop/Dev/first-blades-app/tests/e2e/solicitudes.spec.ts:33), pero no hay tests RTL equivalentes para AprobacionesTable ni SolicitudPasajeForm mostrando un `{ok:false}` devuelto por la action.

Regla: FB-F4-AUD-12 punto 9: cada error esperado devuelve `{ok:false,error}` y el call site lo muestra; aprendizaje Fase 3, no tragar fallos.

Recomendación: agregar tests RTL dirigidos para `{ok:false}` en AprobacionesTable y SolicitudPasajeForm; idealmente también uno explícito en SolicitudAusenciaForm. No hace falta duplicar todos los copies si se cubre cada clase de call site.

## Veredicto

Aprobado con hallazgo bajo de cobertura. La implementación del contrato return-based está correcta: las 4 actions devuelven `{ok:true}` o `{ok:false,error}` para errores esperados, los call sites no descartan el fallo, `fetchRequestForNotification` conserva su throw interno dentro del try/catch best-effort, y `approveDocument`/`rejectDocument` quedaron fuera de alcance y sin tocar.

Sin cambios a esquema/RLS/RPC por exclusión del diff. Verifiqué localmente `npm run typecheck` y 104 tests unitarios tocados; ambos pasaron. En PR #32, Typecheck · Lint · Tests · Build, integración RLS, e2e Playwright y Vercel están verdes.
