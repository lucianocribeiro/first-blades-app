# FB-F4-AUD-13

## Hallazgo

Bajo - el helper compartido no cambió de contrato; el fix real está en el borde de las Server Actions.

Ubicación: [lib/storage.ts (line 24)](/Users/lucianocr/Desktop/Dev/first-blades-app/lib/storage.ts:24), [mi-perfil/actions.ts](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/mi-perfil/actions.ts:83), [FB-F4-18.md (line 21)](/Users/lucianocr/Desktop/Dev/first-blades-app/docs/prompts/FB-F4-18.md:21).

Evidencia: `validateDocumentFile` sigue devolviendo `void` y tirando `throw new Error(...)`; `uploadDocument` también sigue tirando si Storage o signed URL falla. El propio prompt versionado dice "Sin tocar `lib/storage.ts`", y el diff no incluye ese archivo. No hay regresión funcional actual: los únicos llamadores productivos de `validateDocumentFile`/`storageUpload` están en `handleDocumentUpload` y `uploadDocumentForEmployee`, y ambos envuelven esos throws y devuelven `{ok:false,error}`.

Regla: FB-F4-AUD-13 puntos 1-2 pedían confirmar el cambio de contrato del helper compartido y todos sus llamadores.

Recomendación: o bien alinear el informe/prompt de auditoría a la estrategia real ("helper sigue throw, las Server Actions lo capturan"), o convertir efectivamente `lib/storage.ts` a return-based y actualizar sus tests/callers. No bloquea el bug actual porque ningún throw del helper cruza hoy sin captura el límite de Server Action.

## Veredicto

Aprobado con hallazgo bajo de alcance/documentación. El contrato return-based está correctamente aplicado en las 4 actions de documentos y sus 3 call sites: [AprobacionesTable.tsx](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/aprobaciones/AprobacionesTable.tsx:280), [DocumentUploadModal.tsx](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/mi-perfil/DocumentUploadModal.tsx:84), [AdminDocumentUploadModal.tsx](</Users/lucianocr/Desktop/Dev/first-blades-app/app/(app)/mi-perfil/AdminDocumentUploadModal.tsx:84). `getSignedUrls`/`searchEmployees` quedaron sin tocar de forma coherente. No hay cambios de esquema/RLS/RPC ni secretos en el diff.

Verificación: `npm run typecheck` pasó; tests locales acotados pasaron 59/59. En PR #33 están verdes Typecheck · Lint · Tests · Build, integración RLS, e2e Playwright y Vercel.
