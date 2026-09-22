# Codex Subscription Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar Gauntlet con la suscripción de Codex ya autenticada en la máquina local, para que los evals puedan usarla sin copiar tokens, sin guardar `~/.codex/auth.json` y sin convertir la suscripción en una API key de producción.

**Architecture:** Un bridge Node local inicia `codex app-server --stdio`, completa el handshake JSON-RPC y expone una interfaz mínima para `account/read` y completions. El resolver de proveedores usa ese bridge cuando la conexión seleccionada es `codex`; GitHub Copilot sigue siendo opcional. La conexión Codex guarda únicamente metadatos y un modo de credencial local, nunca access/refresh tokens. El control plane remoto puede mostrar la conexión, pero no puede ejecutar Codex si no tiene el proceso local.

**Tech Stack:** TypeScript strict, Next.js App Router, Node `child_process`, Codex App Server, SQLite local, Neon/Postgres, Vitest.

**Spec:** Requerimiento del usuario y documentación oficial de OpenAI App Server/Auth: `https://developers.openai.com/docs/app-server` y `https://developers.openai.com/docs/auth`.

## Global Constraints

- No leer, copiar, devolver ni loguear el contenido de `~/.codex/auth.json`.
- El bridge no acepta tokens arbitrarios desde requests HTTP; usa la sesión administrada por el proceso `codex` local.
- `codex login` debe estar completo antes de conectar; conectar solo hace `account/read`, no corre un modelo.
- No ejecutar evals pagos durante tests o validaciones.
- No usar `any`; errores nuevos serán resultados discriminados y mensajes sanitizados.
- No cambiar el flujo existente de API keys ni romper GitHub Copilot.
- No afirmar soporte Codex en Vercel/producción sin un worker privado que mantenga el proceso local.
- No migrar gstack, no hacer commit, push ni deploy; dejar todo en el worktree.

---

### Task 1: Contrato de credencial local y schema persistente

**Files:**
- Modify: `src/server/subscription-types.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/shared-db.ts`
- Modify: `src/server/subscription-store.ts`
- Modify: `src/server/migrate.ts`
- Test: `test/subscription-logic.test.ts`
- Test: `test/subscription-store.test.ts`

**Interfaces:**
- `SubscriptionAuthMode = "oauth_token" | "codex_local"`.
- `SubscriptionConnectionRecord.authMode` y `SubscriptionConnectionSummary.authMode`.
- Las filas Codex tienen `accessToken: ""`, `refreshToken: null`, `authMode: "codex_local"`.

- [x] **Step 1: Write the failing tests**

Cubrir: resumen sin secretos, round-trip de una conexión Codex sin token, compatibilidad con filas GitHub existentes y disponibilidad que no requiera un access token para `codex_local`.

- [x] **Step 2: Run focused tests and verify the intended failures**

Run: `pnpm test test/subscription-logic.test.ts test/subscription-store.test.ts`

Expected: FAIL porque falta el modo de credencial y la columna persistente.

- [x] **Step 3: Implement SQLite/Postgres parity and migration**

Agregar `auth_mode TEXT NOT NULL DEFAULT 'oauth_token'` a ambas tablas. La inicialización debe ser reejecutable; la migración debe agregar la columna si falta y conservar filas existentes. El mapper debe normalizar filas antiguas como `oauth_token`. Ninguna función pública devuelve tokens.

- [x] **Step 4: Run focused persistence tests**

Run: `pnpm test test/subscription-logic.test.ts test/subscription-store.test.ts test/secrets.test.ts`

Expected: PASS sin imprimir credenciales.

### Task 2: Cliente JSON-RPC de Codex App Server

**Files:**
- Create: `src/server/codex-app-server.ts`
- Test: `test/codex-app-server.test.ts`

**Interfaces:**
- `CodexAppServerTransport` para spawn, stdin/stdout y cierre.
- `CodexAppServerClient.readAccount()` devuelve una unión discriminada con `type`, `planType`, `email`/`name` sanitizados.
- `CodexAppServerClient.complete(input)` devuelve texto o error sanitizado.

- [x] **Step 1: Write failing transport tests**

Usar un transporte fake, no un modelo real. Cubrir handshake, correlación de IDs, mensajes de notificación intercalados, respuesta JSON-RPC de error, timeout, salida inesperada y cierre idempotente.

- [x] **Step 2: Run focused tests and verify the intended failures**

Run: `pnpm test test/codex-app-server.test.ts`

Expected: FAIL porque no existe el cliente.

- [x] **Step 3: Implement the persistent process client**

Iniciar `codex app-server --stdio` con `spawn` sin shell y argumentos fijos. Enviar `initialize`, luego `initialized`; asignar IDs monotónicos y resolver únicamente la respuesta correspondiente. Parsear líneas JSON con `readline`, limitar tamaño de línea, aplicar timeout y matar el proceso al cerrar. No guardar prompts, respuestas ni tokens. Serializar requests de autenticación y limitar completions concurrentes por proceso.

- [x] **Step 4: Run focused tests**

Run: `pnpm test test/codex-app-server.test.ts`

Expected: PASS incluyendo dos cierres consecutivos y proceso caído.

### Task 3: Codex provider y routing de evals

**Files:**
- Create: `src/server/codex-provider.ts`
- Modify: `src/server/eval-providers.ts`
- Modify: `src/engine/provider.ts`
- Test: `test/subscription-provider.test.ts`
- Test: `test/subscription-run-routing.test.ts`

**Interfaces:**
- `CodexProvider implements LlmProvider` usando el cliente App Server.
- `resolveEvaluationProviders` selecciona Codex cuando la conexión está `connected` y `authMode === "codex_local"`.

- [x] **Step 1: Write failing provider/routing tests**

Cubrir account bridge ausente, conexión Codex desconectada, error de `turn/completed`, respuesta vacía, schema JSON opcional y fallback de API keys cuando no se selecciona una suscripción. Los tests usan un cliente fake y nunca llaman a Codex real.

- [x] **Step 2: Run focused tests and verify the intended failures**

Run: `pnpm test test/subscription-provider.test.ts test/subscription-run-routing.test.ts`

Expected: FAIL porque el resolver solo conoce Copilot y no hay provider Codex.

- [x] **Step 3: Implement safe completion routing**

Enviar `thread/start` y `turn/start` por completion, con `approvalPolicy: "never"`, sandbox read-only y sin acceso de red para las operaciones del agente. Acumular deltas y usar el mensaje final como autoridad. Convertir fallos a `EngineResult` sin incluir prompt, respuesta completa ni payload externo en errores. Registrar usage estimado con request key idempotente cuando el camino actual lo soporte.

- [x] **Step 4: Run provider and engine regressions**

Run: `pnpm test test/subscription-provider.test.ts test/subscription-run-routing.test.ts test/engine.test.ts test/judge.test.ts`

Expected: PASS, sin ejecución paga.

### Task 4: API de conexión local, SDK, dashboard y MCP/CLI

**Files:**
- Create: `src/app/api/subscriptions/codex/start/route.ts`
- Create: `src/app/api/v1/subscriptions/codex/start/route.ts`
- Modify: `src/app/api/subscriptions/route.ts`
- Modify: `src/app/api/v1/subscriptions/route.ts`
- Modify: `src/sdk/client.ts`
- Modify: `src/components/dashboard.tsx`
- Modify: `src/mcp/protocol.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/cli/index.ts`
- Test: `test/subscription-routes.test.ts`
- Test: `test/sdk-client.test.ts`

**Interfaces:**
- `POST /api/subscriptions/codex/start` hace `account/read`, persiste solo metadata y devuelve un summary redactado.
- El endpoint devuelve `409`/`503` discriminado si Codex no está instalado o no hay login.
- SDK, MCP, CLI y dashboard muestran el mismo estado y no reciben secretos.

- [x] **Step 1: Write failing contract tests**

Cubrir cuenta ChatGPT válida, cuenta API key no compatible con el bridge, Codex no instalado, respuesta de API sin tokens, estado dinámico del provider y selección de conexión en un run.

- [x] **Step 2: Run focused contract tests and verify the intended failures**

Run: `pnpm test test/subscription-routes.test.ts test/sdk-client.test.ts`

Expected: FAIL porque no existe el endpoint ni el método de conexión.

- [x] **Step 3: Implement one shared connection contract**

El route llama al manager local, rechaza cualquier modo que no sea ChatGPT-managed para este bridge y hace upsert idempotente por workspace/provider/account. La UI reemplaza `coming_soon` por `Conectar Codex` solo cuando el bridge está disponible; producción remota conserva el estado no disponible. SDK/MCP/CLI reutilizan el mismo summary y pasan `subscriptionConnectionId` sin duplicar lógica ni mostrar credenciales.

- [x] **Step 4: Run cross-surface tests**

Run: `pnpm test test/subscription-routes.test.ts test/sdk-client.test.ts test/mcp.test.ts test/cli.test.ts test/http-routes.test.ts`

Expected: PASS.

### Task 5: Documentación y validación final

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/production.md`
- Modify: `docs/operations/backup-recovery.md`
- Modify: `docs/superpowers/plans/2026-09-22-codex-subscription-bridge.md`

- [x] **Step 1: Document the local-only boundary**

Explicar `codex login`, `codex app-server`, el endpoint de conexión, que no se copia `~/.codex/auth.json`, que Vercel no puede usar la sesión local y que API billing sigue siendo distinto.

- [x] **Step 2: Run repository validations without paid calls**

Run: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit --prod`, `git diff --check`.

Expected: typecheck, tests, build and diff check pass; audit reports no unresolved production vulnerability. Neon integration se ejecuta solo si ya hay credenciales configuradas y no modifica datos de usuario.

- [x] **Step 3: Verify no credential leakage**

Run targeted searches for `auth.json`, token fields in public responses, `console.log`, `any` and debug TODOs. Confirm no Codex model request was made and leave all changes uncommitted.
