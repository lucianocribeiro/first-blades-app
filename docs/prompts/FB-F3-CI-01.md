# FB-F3-CI-01 — Deuda de CI: alinear la versión de Node del workflow

> **Tipo:** fix de configuración de CI (no toca código de feature ni esquema). Tarea de cierre de Fase 3.

---

## Contexto

El workflow de CI declara **Node 20**, pero en la práctica corre en **Node 24** (deprecación / inconsistencia detectada durante la fase). El proyecto en Vercel ya usa Node 24.x. Hay que alinear la versión declarada con la que efectivamente se usa, para que CI sea reproducible y no arrastre una deprecación silenciosa.

## Inspección previa

- Revisar `.github/workflows/ci.yml` (y cualquier otro workflow) para ubicar dónde se declara la versión de Node (`actions/setup-node` con `node-version`, o una matriz, o un `.nvmrc`/`engines` en `package.json`).
- Confirmar la versión objetivo: **Node 24** (alinear con lo que corre y con Vercel `nodeVersion: 24.x`). Confirmar la línea LTS/menor exacta si el proyecto fija una.

## Alcance

- Declarar **Node 24** de forma explícita y consistente en:
  - el/los workflow(s) de CI (`node-version`),
  - y, si el repo los usa como fuente de verdad, `.nvmrc` y/o `engines.node` en `package.json`.
- No cambiar nada más (ni deps, ni build, ni tests). Es solo alinear la versión.
- Si al fijar 24 aparece algún warning/incompatibilidad de una action que pedía 20, actualizarla a la versión de la action que soporta Node 24 (mínimo necesario), sin arrastrar cambios de más.

## Verificación (por CI)

- CI corre en **Node 24** declarado explícitamente (no por default implícito).
- Todos los jobs verdes: typecheck, lint, tests, build, e integración RLS (hard-fail si no corre).
- Sin cambios funcionales: el diff es de configuración.

## Definition of Done

- Versión de Node alineada a 24 en el/los workflow(s) (y `.nvmrc`/`engines` si aplica).
- CI verde en un PR chico dedicado.
- **Versionar el propio `.md`** en `docs/prompts/FB-F3-CI-01.md`.
- Cerrar con `dod-checklist`.
- Es fix de solo-configuración de CI → no requiere auditoría de Codex; alcanza CI verde. Al terminar, mergear.

---

## Nota sobre la premisa del contexto (discrepancia observada)

Al inspeccionar `.github/workflows/ci.yml` en `main` (previo a este fix), **el workflow declaraba Node `22`, no Node `20`** como dice el contexto de esta tarea (`node-version: '22'` en ambos jobs — `unit` e `integration`; también coincide con el Node local del entorno, `v22.17.1`). No encontré evidencia de que en algún punto haya dicho `20`; puede que el contexto se refiera a una deprecación de GitHub Actions para runners/actions más viejos, o a información desactualizada. Lo reporto en vez de asumir: la corrección que pide la tarea (llevar la versión **declarada** a **24**, alineada con Vercel) es igual de válida y se aplicó tal cual, independientemente del valor de partida exacto.

## Implementación

- **Alcance real del diff:** 2 líneas en `.github/workflows/ci.yml` — `node-version: '22'` → `node-version: '24'` en el job `unit` (Typecheck · Lint · Tests · Build) y en el job `integration` (Tests de integración RLS). Nada más tocado.
- **`.nvmrc` / `engines.node`:** el repo **no tenía ninguno de los dos** antes de este fix (no hay `.nvmrc`; `package.json` no tiene bloque `engines`). Como el enunciado condiciona agregarlos a "si el repo los usa como fuente de verdad" y ninguno existía, **no se agregaron** — habría sido introducir un mecanismo de pinning nuevo, fuera del alcance de "alinear la versión ya declarada". Si se quiere ese pinning adicional (útil para desarrollo local con nvm/fnm), es una pieza aparte, no este fix.
- **Actions:** `actions/setup-node@v4` soporta cualquier `node-version` vía el input (incluido `24`) sin necesitar bump de versión de la action. No se tocó ninguna otra action.
- **Verificación:** CI verde en el PR dedicado, con el log de `Setup Node.js` de ambos jobs confirmando que el runner resolvió a Node 24.x (no un default implícito).
