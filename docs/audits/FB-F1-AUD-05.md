# FB-F1-AUD-05 — Spot-check de cierre de Fase 1

## 1. Veredicto

**Fase 1 apta para cierre: sí.** Los ocho hallazgos de FB-F1-AUD-04 están cerrados y no se detectaron regresiones bloqueantes. Queda únicamente una corrección documental no bloqueante en el encabezado del test de purga.

## 2. Hallazgos de FB-F1-AUD-04

| Hallazgo | Estado | Evidencia |
| --- | --- | --- |
| **A1 — autorización de signed URLs** | **Cerrado** | `getSignedUrls()` exige sesión con `requireAuth()`, consulta `documents` mediante el cliente de sesión sujeto a RLS y firma únicamente los paths devueltos por esa consulta (`app/(app)/mi-perfil/actions.ts:117-145`). La policy efectiva permite documentos propios o cualquier documento al admin, pero no documentos de terceros para empleado/supervisor (`supabase/migrations/0004_rls_fixes.sql:10-16`). La firma con service role ocurre recién después de esa autorización (`lib/storage.ts:39-48`). |
| **A2 — coherencia `storage_path` / `user_id`** | **Cerrado** | La constraint `documents_storage_path_matches_user` exige `storage_path LIKE user_id::text || '/%'` (`supabase/migrations/0005_documents_storage_path_constraint.sql:5-7`). Integración cubre path propio positivo y carpeta ajena negativa (`tests/integration/rls.test.ts:270-293`). |
| **A3 — visibilidad de `estudio_medico`** | **Cerrado** | Mi Perfil dejó de filtrar el tipo y entrega al dueño todos sus documentos (`app/(app)/mi-perfil/page.tsx:18-40`). RLS mantiene SELECT limitado a admin o dueño (`supabase/migrations/0004_rls_fixes.sql:12-16`). Integración verifica dueño visible, otro empleado invisible y supervisor invisible (`tests/integration/mi-perfil.test.ts:361-392`); Storage aplica la misma separación por carpeta (`supabase/migrations/0004_rls_fixes.sql:22-29`). |
| **A4 — error de purga y reintento** | **Cerrado** | La purga inspecciona `removeError`, incrementa `failed` y continúa sin marcar `file_purged_at`; solo actualiza tras borrado exitoso y devuelve `{ purged, failed }` (`lib/purge.ts:6-9`, `lib/purge.ts:53-94`). Así, un fallo conserva elegibilidad para reintento (`lib/purge.ts:73-76`). |
| **A5 — excepción de carga admin** | **Cerrado** | La excepción está declarada como única ruta de auto-aprobación (`CLAUDE.md:42-55`). `uploadDocumentForEmployee()` exige admin y crea `aprobado` con revisor/fecha (`app/(app)/mi-perfil/actions.ts:174-215`); la carga propia exige auth, restringe tipos y fuerza `pendiente` (`app/(app)/mi-perfil/actions.ts:54-103`). La DB fuerza `pendiente` para inserts no-admin (`supabase/migrations/0001_init.sql:279-289`) y la integración fija ambos lados de la excepción (`tests/integration/mi-perfil.test.ts:511-547`). No apareció otro insert productivo de documentos. |
| **M1 — `audit_log` al aprobar/rechazar** | **Cerrado** | Ambas server actions exigen admin, actualizan el documento y luego insertan eventos `document_approved` / `document_rejected` en `audit_log` dentro de un bloque no bloqueante (`app/(app)/aprobaciones/actions.ts:10-41`, `app/(app)/aprobaciones/actions.ts:46-80`). Se conserva deliberadamente la implementación en server action, no trigger. |
| **M2 — rechazo con motivo obligatorio** | **Cerrado** | La constraint `documents_rechazo_requiere_motivo` rechaza `NULL`, vacío y whitespace cuando `estado = 'rechazado'` (`supabase/migrations/0006_documents_rechazo_motivo_obligatorio.sql:4-9`). Integración cubre rechazo sin motivo y caso válido (`tests/integration/mi-perfil.test.ts:480-509`). |
| **M3 — purga productiva contra bucket real** | **Cerrado** | El test sube un objeto al bucket real, inserta una fila elegible, ejecuta `purgeRejectedDocuments(admin)`, comprueba contadores, ausencia del objeto y `file_purged_at`, conservando la fila (`tests/integration/purge.test.ts:188-241`). CI levanta Supabase local y ejecuta la suite de integración con sus credenciales reales (`.github/workflows/ci.yml:64-89`). |

## 3. No-regresión

**Confirmada; no se detectaron regresiones bloqueantes.**

| Control | Resultado | Evidencia |
| --- | --- | --- |
| Limpieza de Storage mediante API, sin SQL crudo sobre `storage.objects` | Confirmado | `emptyStorageBucket()` lista y elimina con Storage API (`tests/integration/helpers.ts:73-102`) y el setup la utiliza (`tests/integration/helpers.ts:142-146`). No hay `DELETE FROM storage.objects` en migraciones/tests. |
| Advisory lock de integración | Confirmado | Se toma antes del setup y se mantiene durante el archivo (`tests/integration/helpers.ts:120-133`); ante error se libera, se cierra la conexión y se vuelve a lanzar el error (`tests/integration/helpers.ts:223-229`). |
| Setup sin `try/catch` que silencie fallos | Confirmado | El setup propaga el error después del cleanup (`tests/integration/helpers.ts:223-229`). Los `afterAll` solo aíslan errores de liberación/cierre (`tests/integration/mi-perfil.test.ts:85-99`, `tests/integration/purge.test.ts:70-84`). |
| Tipado correcto de seeds | Confirmado | Los paths se construyen en TypeScript y se pasan como valores ya tipados, evitando reutilizar un parámetro como UUID/text (`tests/integration/purge.test.ts:44-65`). `npm run typecheck` finalizó correctamente. |
| Seeds compatibles con constraints nuevas | Confirmado | Seeds de rechazados incluyen motivo y todos los paths comienzan con el `user_id` (`tests/integration/purge.test.ts:44-65`); los seeds de Mi Perfil siguen el mismo patrón (`tests/integration/mi-perfil.test.ts:51-82`). La integración contiene casos positivos y negativos explícitos para ambas constraints. |
| Suite | Confirmado con alcance explícito | En este spot-check: `npm run typecheck`, `npm run lint` y `npm run test` verdes; 6 archivos y 87 tests unitarios pasaron. La integración no pudo reejecutarse localmente porque Docker/Supabase no estaba activo. Como evidencia de cierre, el solicitante reporta CI verde para FB-F1-16 a FB-F1-20, `origin/main` apunta al commit de FB-F1-20, y CI ejecuta la suite completa contra Supabase local (`.github/workflows/ci.yml:9-40`, `.github/workflows/ci.yml:48-89`). |

Observación no bloqueante: el encabezado histórico de `tests/integration/purge.test.ts:1-6` todavía dice que la eliminación real de Storage no se prueba, pero el test productivo agregado en `tests/integration/purge.test.ts:188-241` demuestra lo contrario. Es documentación obsoleta, no una falla de cobertura ni de runtime.

## 4. DoD actualizado de Fase 1

| Ítem | Estado | Evidencia / actualización |
| --- | --- | --- |
| Mi Perfil muestra datos propios para empleado/supervisor y acceso extendido para admin | **Cumplido** | Auth y carga de perfil en `lib/auth.ts:8-26`; Mi Perfil en `app/(app)/mi-perfil/page.tsx:12-44`. El valor de `entrevista_tecnica` se reemplaza por `null` antes de pasarlo al componente cliente para no-admin (`app/(app)/mi-perfil/page.tsx:43-44`). |
| Empleado/supervisor no editan perfiles; admin sí | **Cumplido** | La server action exige admin (`app/(app)/mi-perfil/actions.ts:28-50`) y la policy de UPDATE es admin-only (`supabase/migrations/0001_init.sql:250-255`). |
| Supervisor ve su fila y equipo en `profiles` por RLS | **Cumplido** | Policy de perfiles (`supabase/migrations/0001_init.sql:235-244`) y cobertura de integración (`tests/integration/rls.test.ts:168-197`). La ejercitación UI end-to-end del módulo Equipo queda deliberadamente para Fase 2. |
| Submissions nativas de empleado/supervisor entran `pendiente` y van a Aprobaciones | **Cumplido** | Carga propia fuerza `pendiente` (`app/(app)/mi-perfil/actions.ts:86-103`), DB lo exige a no-admin (`supabase/migrations/0001_init.sql:279-285`) y Aprobaciones consulta pendientes (`app/(app)/aprobaciones/page.tsx:16-21`). |
| No hay auto-aprobación salvo la excepción admin documentada | **Cumplido** | Excepción y alcance en `CLAUDE.md:42-55`; tests en `tests/integration/mi-perfil.test.ts:511-547`. |
| Rechazo exige motivo obligatorio | **Cumplido** | Validación temprana en `app/(app)/aprobaciones/actions.ts:46-64` e invariante DB en `supabase/migrations/0006_documents_rechazo_motivo_obligatorio.sql:4-9`. |
| Bucket `documents` privado | **Cumplido** | `public = false` en `supabase/migrations/0001_init.sql:440-453`. |
| Signed URLs server-side, con expiración razonable y sin URLs públicas | **Cumplido** | Autorización por RLS en `app/(app)/mi-perfil/actions.ts:117-145`; firma privada por una hora en `lib/storage.ts:33-48`. |
| `storage_path` estructurado por `user_id` y protegido en DB | **Cumplido** | Generación en `lib/storage.ts:58-71` y constraint en `supabase/migrations/0005_documents_storage_path_constraint.sql:5-7`. |
| Policies de Storage cubren carpeta propia y admin | **Cumplido** | SELECT e INSERT efectivos en `supabase/migrations/0004_rls_fixes.sql:18-44`; DELETE admin-only en `supabase/migrations/0001_init.sql:478-483`. |
| Habilitar RLS sobre `storage.objects` | **Dropeado (no aplica)** | Se elimina del DoD: Supabase es dueña de la tabla. No se propone ni requiere `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`. |
| Control de acceso a Storage validado mediante Storage API real en CI | **Cumplido** | Casos de upload/list/delete por rol usan Storage API real (`tests/integration/rls.test.ts:704-787`); CI levanta Supabase y corre integración (`.github/workflows/ci.yml:64-89`). |
| Retención/purga de archivo a 30 días, con fila conservada | **Cumplido** | Selección, borrado, manejo de fallos, marca e idempotencia en `lib/purge.ts:37-94`; integración real en `tests/integration/purge.test.ts:188-241`. Conservar la fila es la decisión vigente. |
| Endpoint/cron protegido | **Cumplido** | Se exige bearer secret y se falla cerrado si falta (`app/api/cron/purge-rejected-docs/route.ts:8-20`). |
| Aprobaciones/rechazos trazados en `audit_log`; lectura solo admin, sin insert directo de usuarios | **Cumplido** | Escritura no bloqueante en `app/(app)/aprobaciones/actions.ts:27-38` y `app/(app)/aprobaciones/actions.ts:66-77`; policy de lectura admin-only y ausencia de policy INSERT cliente en `supabase/migrations/0001_init.sql:427-434`. |
| `service_role` solo server-side | **Cumplido** | Cliente admin usa `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts:5-12`); no se expone como `NEXT_PUBLIC_*`. |
| Secrets/env completos y `.env.local` no versionado | **Cumplido** | Variables documentadas en `.env.example:1-29`; `.env.local` ignorado en `.gitignore:25-27`. |
| Tests de Fase 1, límites de rol y suite completa en CI | **Cumplido** | Unitarios locales: 87/87. Integración real configurada en `vitest.integration.config.ts:4-21` y CI en `.github/workflows/ci.yml:48-89`; CI verde informado para las cinco remediaciones. |
| Diferidos de producto | **A actualizar fuera del DoD de Fase 1** | Email/notificaciones, módulo Equipo completo, visibilidad de equipo del supervisor end-to-end y calendario pasan a Fase 2; Visma pasa a Fase 3. No bloquean este cierre. |

## 5. Pendientes

No hay pendientes funcionales o de seguridad que bloqueen el cierre de Fase 1.

- **Diferible / mantenimiento:** actualizar el comentario obsoleto de `tests/integration/purge.test.ts:1-6` para reflejar que el archivo sí ejecuta la purga productiva contra Storage real. Si se exige trazabilidad formal para toda modificación posterior al cierre, ordenarlo como un `FB-F1-NN` documental.
- **Fases posteriores:** notificaciones por email, módulo Equipo completo, visibilidad del equipo del supervisor ejercitada end-to-end y tokens/lógica de calendario en Fase 2; Visma en Fase 3.

**Recomendación explícita:** cerrar Fase 1.
