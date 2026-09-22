# Subscription-backed Agent Evals Implementation Plan

> Codex-specific scope was extended by [`2026-09-22-codex-subscription-bridge.md`](2026-09-22-codex-subscription-bridge.md): the supported path is now the local Codex App Server bridge, while this plan remains the GitHub Copilot foundation.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un workspace conecte una suscripción de GitHub Copilot y que los evals consuman esa cuenta, registrando el uso sin exponer tokens ni convertir la suscripción en una API key permanente.

**Architecture:** Se agrega un límite explícito entre conexiones de suscripción y proveedores de inferencia. GitHub OAuth entrega un token cifrado al storage; el resolver crea un `CopilotProvider` por corrida y conserva el fallback actual de API keys. La UI y las APIs trabajan con estados de conexión y el ledger registra requests y tokens estimados, identificados por una clave idempotente.

**Tech Stack:** Next.js App Router, TypeScript strict, SQLite local, Neon/Postgres compartido, `@github/copilot-sdk`, Vitest.

**Spec:** Requerimiento del usuario y `.context/attachments/sRfSU2/image.png`.

## Global Constraints

- No almacenar tokens OAuth en el cliente, respuestas API, logs ni trazas.
- No usar `any`; errores como resultados discriminados.
- GitHub Copilot es el único conector funcional de este corte.
- Codex no usa cookies, scraping ni auth local copiada; su implementación local está definida en el plan del 2026-09-22.
- SuperGrok no se implementa hasta tener un flujo oficial verificable.
- API keys existentes siguen funcionando como fallback explícito.
- No commit, push ni deploy.

---

### Task 1: Contratos y estado puro de suscripciones

**Files:**
- Create: `src/server/subscription-types.ts`
- Create: `src/server/subscription-logic.ts`
- Test: `test/subscription-logic.test.ts`

**Interfaces:**
- Produces `SubscriptionProvider`, `SubscriptionStatus`, `SubscriptionConnectionSummary`, `UsageLedgerEntry`, `parseOAuthCallback`, `estimateTokenCount` and `usageStatus` for storage, routes and providers.

- [ ] **Step 1: Write the failing tests**

```ts
it("classifies an active connection without exposing credentials", () => {
  expect(toSubscriptionSummary({ id: "c1", provider: "github_copilot", status: "connected", accountLogin: "isidro", accessToken: "secret" })).toEqual({
    id: "c1", provider: "github_copilot", status: "connected", accountLogin: "isidro",
  });
});

it("rejects an OAuth callback without a code or state", () => {
  expect(parseOAuthCallback(new URL("https://app.test/callback?code=x")).ok).toBe(false);
});

it("estimates tokens deterministically and marks the source", () => {
  expect(estimateTokenCount("12345678")).toEqual({ count: 2, source: "estimated" });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test test/subscription-logic.test.ts`

Expected: FAIL because the subscription contracts and helpers do not exist.

- [ ] **Step 3: Implement the minimal discriminated contracts and helpers**

`parseOAuthCallback` must require non-empty `code` and `state`; `toSubscriptionSummary` must omit access and refresh tokens; `estimateTokenCount` must use `Math.ceil(text.length / 4)` with a minimum of one for non-empty text.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm test test/subscription-logic.test.ts`

Expected: PASS.

### Task 2: SQLite/Neon storage and schema

**Files:**
- Modify: `src/server/db.ts`
- Modify: `src/server/shared-db.ts`
- Modify: `src/server/shared-store.ts`
- Create: `src/server/subscription-store.ts`
- Test: `test/subscription-store.test.ts`

**Interfaces:**
- Consumes the contracts from Task 1.
- Produces `listSubscriptionConnections`, `getSubscriptionConnection`, `upsertGitHubConnection`, `disconnectSubscription`, `recordUsage`, and `listUsage` with SQLite/Neon parity.

- [ ] **Step 1: Write failing storage tests**

Cover connection upsert idempotency by GitHub account, encrypted token round-trip, summary redaction, disconnect state, and usage deduplication by `requestKey`.

- [ ] **Step 2: Run focused tests and verify the intended failures**

Run: `pnpm test test/subscription-store.test.ts`

Expected: FAIL because the table and store functions do not exist.

- [ ] **Step 3: Add both schemas and storage adapters**

Add `subscription_connections` and `subscription_usage` to SQLite and Neon initialization. Use `encryptSecret`/`decryptSecret`, unique `(workspace_id, provider, account_id)`, and unique `(workspace_id, request_key)`. Never return credential columns from public store functions.

- [ ] **Step 4: Run storage tests and the existing persistence tests**

Run: `pnpm test test/subscription-store.test.ts test/secrets.test.ts test/shared-db.integration.test.ts`

Expected: PASS locally; Neon integration remains skipped when `DATABASE_URL` is absent.

### Task 3: GitHub OAuth routes and provider status API

**Files:**
- Create: `src/server/github-oauth.ts`
- Create: `src/app/api/subscriptions/route.ts`
- Create: `src/app/api/subscriptions/github/start/route.ts`
- Create: `src/app/api/subscriptions/github/callback/route.ts`
- Create: `src/app/api/subscriptions/[id]/route.ts`
- Test: `test/subscription-routes.test.ts`

**Interfaces:**
- Consumes `subscription-store` and `github-oauth` helpers.
- Produces `GET /api/subscriptions`, `POST /api/subscriptions/github/start`, `GET /api/subscriptions/github/callback`, and `DELETE /api/subscriptions/:id`.

- [ ] **Step 1: Write failing route tests**

Test missing OAuth configuration, state mismatch, token exchange failure, successful account lookup, response redaction, and disconnect authorization. Mock only the external GitHub fetch boundary.

- [ ] **Step 2: Run the focused route tests and verify they fail**

Run: `pnpm test test/subscription-routes.test.ts`

Expected: FAIL because routes and OAuth helpers do not exist.

- [ ] **Step 3: Implement signed state and OAuth exchange**

Sign `workspaceId`, nonce and expiry with HMAC using `GAUNTLET_SECRETS_KEY`; exchange the code server-side at GitHub, call `/user`, and persist the token encrypted. Require `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_OAUTH_CALLBACK_URL` in production. Reject expired or replayed state.

- [ ] **Step 4: Run focused tests and route regression tests**

Run: `pnpm test test/subscription-routes.test.ts test/http-routes.test.ts test/secrets.test.ts`

Expected: PASS.

### Task 4: Copilot-backed LLM provider and usage ledger

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/engine/provider.ts`
- Create: `src/server/subscription-provider.ts`
- Test: `test/subscription-provider.test.ts`

**Interfaces:**
- Consumes a decrypted GitHub token and a usage callback.
- Produces `CopilotProvider implements LlmProvider` with family `copilot` and `createSubscriptionProviders` for judge/generation selection.

- [ ] **Step 1: Write failing provider tests**

Cover prompt conversion, empty response, provider error redaction, disconnect cleanup, and exactly-once usage callback for a request key. Use a test seam around the SDK client; do not test the SDK internals.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm test test/subscription-provider.test.ts`

Expected: FAIL because the provider and package dependency do not exist.

- [ ] **Step 3: Add the official Copilot SDK and implement the adapter**

Use `CopilotClient({ mode: "empty", gitHubToken, useLoggedInUser: false })`, create a session per completion, pass the model and a prompt that preserves system/messages, use `sendAndWait`, disconnect the session/client in `finally`, and record estimated input/output tokens with the request key. Convert SDK failures to existing `EngineResult` errors without including provider payloads.

- [ ] **Step 4: Run provider and engine tests**

Run: `pnpm test test/subscription-provider.test.ts test/engine.test.ts test/judge.test.ts`

Expected: PASS.

### Task 5: Wire runs, replay and gates to a selected subscription

**Files:**
- Modify: `src/server/run-store.ts`
- Modify: `src/server/agent-store.ts`
- Modify: `src/app/api/agents/[id]/run/route.ts`
- Modify: `src/app/api/agents/run-all/route.ts`
- Modify: `src/server/regression-runner.ts`
- Modify: `src/server/shared-regression-store.ts`
- Modify: `src/server/gate-worker.ts`
- Modify: `src/app/api/v1/runs/route.ts`
- Test: `test/subscription-run-routing.test.ts`

**Interfaces:**
- Adds optional `subscriptionConnectionId` to run/replay/gate inputs.
- Existing API-key behavior remains unchanged when the field is absent.

- [ ] **Step 1: Write failing routing tests**

Assert selected connection is used, missing/disconnected connection returns a safe 409/422, API-key fallback remains available, and the selected connection id is never persisted in report payloads or returned secrets.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm test test/subscription-run-routing.test.ts`

Expected: FAIL because run inputs do not carry a subscription connection.

- [ ] **Step 3: Resolve providers at execution time**

Resolve the connection after the run is inserted, so queued runs use current connection state. Use the same resolver in run, replay and gate worker paths. Record usage with `runId` and deterministic request keys derived from run/stage/attempt.

- [ ] **Step 4: Run routing, gate and replay tests**

Run: `pnpm test test/subscription-run-routing.test.ts test/gate-worker.test.ts test/replay.test.ts test/durable-gates.test.ts`

Expected: PASS.

### Task 6: Dashboard connection flow and documentation

**Files:**
- Modify: `src/components/dashboard.tsx`
- Modify: `README.md`
- Modify: `docs/operations/production.md`
- Modify: `docs/operations/backup-recovery.md`
- Test: `test/dashboard-contract.test.ts`

**Interfaces:**
- Dashboard consumes the public subscription summary and sends `subscriptionConnectionId` when starting runs.

- [ ] **Step 1: Write failing contract tests**

Assert the UI contract exposes Connect/Connected/Reconnect states, never renders token fields, and sends the selected connection id on run requests.

- [ ] **Step 2: Implement the connection panel**

Add a provider list matching the supplied flow: GitHub Copilot connect, Codex local bridge when `codex app-server` is available, SuperGrok unavailable. Poll status after OAuth return and allow disconnect/reconnect. Disable run buttons when no provider or API-key fallback exists.

- [ ] **Step 3: Document setup and limitations**

Document GitHub OAuth app variables, `GAUNTLET_SECRETS_KEY`, token redaction, estimated usage, local versus Neon storage, local Codex bridge limitations, and SuperGrok status. Keep API-key fallback documented.

- [ ] **Step 4: Run UI contract and full verification**

Run: `pnpm test test/dashboard-contract.test.ts && pnpm typecheck && pnpm test && pnpm build && pnpm audit --prod`

Expected: all project tests pass; build succeeds; audit reports no unresolved high/critical dependency issue.
