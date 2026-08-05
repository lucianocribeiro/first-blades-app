# FB-F5-AUD-02 — Auditoría de Codex

- **ID:** FB-F5-AUD-02
- **PR auditada:** #39
- **Rama:** `fase-5/f5-02-migracion`
- **Fecha:** 2026-08-05
- **Veredicto:** `LIMPIO CON OBSERVACIONES`

---

Hallazgo 1
Severidad: Medio
Ubicación: [supabase/migrations/0020_fase5_procedimientos.sql (line 69)](/Users/lucianocr/Desktop/Dev/first-blades-app/supabase/migrations/0020_fase5_procedimientos.sql:69)
Evidencia: el CHECK valida btrim(contenido_texto) <> '', pero para archivo solo exige file_path IS NOT NULL.
Regla violada: foco 5 del pedido: string vacío o de solo espacios debe tratarse como ausente.
Recomendación: ajustar el CHECK para que file_path también requiera btrim(file_path) <> '' y agregar caso negativo con file_path = '' / '   '.
Hallazgo 2
Severidad: Bajo
Ubicación: [tests/integration/migration.test.ts (line 1120)](/Users/lucianocr/Desktop/Dev/first-blades-app/tests/integration/migration.test.ts:1120)
Evidencia: el drift detector solo verifica que el owner no sea authenticated/anon/public y que coincida con is_admin()/auth_role(). No exige literalmente postgres. Los grants de las RPCs se verifican contra authenticated, anon y public, pero no como ACL exacta.
Regla violada: focos 1 y 9: owner postgres; grants inventariados.
Recomendación: endurecer el test de catálogo post-push para owner esperado y ACL exacta, o documentar explícitamente el rol admin aceptado si no es postgres.
Verificaciones relevantes
RPCs: guardas internas contra auth.uid(), NULL tratado como no-admin, SECURITY DEFINER, SET search_path = public, FOR UPDATE en updates, sin EXCEPTION WHEN OTHERS, sin COMMIT, sin caminos parciales visibles por lectura del SQL.
log_audit(): el cuerpo no cambia; hay REVOKE para anon, authenticated y PUBLIC; el SQL comenta por qué las RPCs SECURITY DEFINER pueden seguir invocándola.
RLS procedures: procedures_select_all se elimina y queda procedures_select + procedures_write_admin.
Renombres: no encontré referencias reales a columnas viejas de procedures fuera del propio ALTER TABLE y tests de drift; los storage_path restantes son de documents.
types.ts: coincide campo por campo con la migración en lo revisable por diff; sigue pendiente la validación autoritativa supabase gen types --linked post-push.
PR #39: abierto, rama correcta, CI remoto en verde. Localmente npm run typecheck pasó; npm run test:integration se saltó por no haber PostgreSQL local disponible.
Veredicto: LIMPIO CON OBSERVACIONES

---

Los dos hallazgos de esta auditoría se resolvieron en `FB-F5-03` (misma PR #39, rama `fase-5/f5-02-migracion`).
