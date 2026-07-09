# FB-F3-AUD-16 — Informe de auditoría (Codex)

Alcance: FB-F3-16 (PR #13) — server action de solicitud de día de trámite, gating de rol, traducción de errores y confianza en la RLS. No re-audita la migración 0012.

## Hallazgos
Ninguno dentro del alcance FB-F3-16.

## Evidencia
- Server action usa `createServerClient()` y no `createAdminClient()`: `app/(app)/solicitud-ausencia/actions.ts:19`.
- `user_id` sale de `requireAuth()`/sesión, no del input; `motivo_ausencia`, `estado`, `fecha_inicio` y `fecha_fin` se fijan server-side: `app/(app)/solicitud-ausencia/actions.ts:20`, `app/(app)/solicitud-ausencia/logic.ts:17`, `lib/auth.ts:8`.
- Admin queda bloqueado en la action y en modo consulta en la page: `app/(app)/solicitud-ausencia/actions.ts:13`, `app/(app)/solicitud-ausencia/page.tsx:14`.
- "Mis solicitudes" aplica `.eq('user_id', profile.id)` además de RLS: `app/(app)/solicitud-ausencia/page.tsx:32`.
- Solo `23505` se traduce a copy amigable; otros errores pasan a error visible genérico y se loguean: `app/(app)/solicitud-ausencia/logic.ts:34`, `app/(app)/solicitud-ausencia/actions.ts:28`.
- RLS base cubre `user_id = auth.uid()` y `estado = 'pendiente'`: `supabase/migrations/0001_init.sql:369`.
- Tests RLS relevantes existen con `asUser` bajo rol `authenticated`, no `service_role`: `tests/integration/helpers.ts:237`, `tests/integration/rls.test.ts:453`.
- `StatusBadge` conserva comportamiento por defecto con `label ?? cfg.label`: `components/ui/StatusBadge.tsx:31`.

## Verificación
- `npm test -- tests/unit/solicitud-ausencia.test.ts`: 16/16 pasan.
- Integración focalizada: sin Postgres local en el entorno del auditor, Vitest marcó esos tests como skipped. El setup falla si `TEST_DATABASE_URL` está configurada y la DB no responde (hard-fail, no skip silencioso). La corrida real de integración ocurrió en CI sobre PR #13 (231 tests verdes).

## Veredicto
Limpio para merge.
