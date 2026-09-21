# Agent Evals Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add workspace-scoped ingestion and MCP control to the existing agent evaluation engine while keeping black-box runs reproducible.

**Architecture:** Extend the current SQLite persistence with a default workspace, hashed machine keys, optional observed-only agent metadata, and idempotent trace envelopes. Add typed HTTP routes and a small MCP JSON-RPC adapter over the same server functions; the dashboard reads one workspace DTO that combines suite runs and observed traces.

**Tech Stack:** TypeScript strict mode, Next.js App Router, better-sqlite3, existing `runEval` engine, Vitest, JSON-RPC MCP transport.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-evals-platform-design.md`

## Global Constraints

- Preserve the existing black-box runner and suite scoring; do not add a second evaluator.
- Keep secrets out of public DTOs and trace payloads.
- Use discriminated unions for validation results and `unknown` at API boundaries.
- Scope every new persisted record to a workspace.
- Do not add hosted dependencies or claim hosted auth in the local slice.
- Use explicit file staging if this plan is later committed; never use `git add .`.

### Task 1: Workspace and API key persistence

**Files:**
- Modify: `src/server/db.ts`
- Create: `src/server/workspace-store.ts`
- Create: `src/server/auth.ts`
- Test: `test/workspace-store.test.ts`

**Interfaces:**
- `getDefaultWorkspace(): Workspace`
- `createWorkspaceKey(workspaceId: string, name: string): { id: string; token: string; prefix: string }`
- `resolveWorkspaceKey(raw: string | null): Workspace | null`

- [ ] Add migrations for `workspaces` and `workspace_keys` without changing existing run behavior.
- [ ] Hash generated key material before storage and return the raw token only from the creation function.
- [ ] Write tests for first-use default workspace, key resolution, unknown key rejection, and no raw token persistence.
- [ ] Run `pnpm vitest run test/workspace-store.test.ts`.

### Task 2: Workspace-aware agent and trace records

**Files:**
- Modify: `src/server/db.ts`
- Modify: `src/server/agent-store.ts`
- Create: `src/server/trace-store.ts`
- Test: `test/trace-store.test.ts`

**Interfaces:**
- `registerWorkspaceAgent(workspaceId: string, input: AgentRegistration): AgentRow`
- `ingestTrace(workspaceId: string, envelope: TraceEnvelope): { inserted: boolean; traceId: string }`
- `getAgentTraces(workspaceId: string, agentId: string, limit: number): TraceSummary[]`

- [ ] Add nullable endpoint/system prompt support plus `source`, `external_id`, and `workspace_id` migration fields.
- [ ] Keep `createAgent` backward-compatible by assigning the default workspace and `source: "manual"`.
- [ ] Make trace ingestion idempotent on workspace and event ID.
- [ ] Redact payloads at the persistence boundary and keep summary fields typed.
- [ ] Test tenant isolation, idempotency, observed-only registration, and bounded listing.
- [ ] Run the targeted tests and existing agent-store tests.

### Task 3: Authenticated HTTP registration and ingest routes

**Files:**
- Create: `src/app/api/v1/agents/route.ts`
- Create: `src/app/api/v1/traces/route.ts`
- Create: `src/app/api/v1/keys/route.ts`
- Create: `src/server/http-input.ts`
- Test: `test/http-input.test.ts`

**Interfaces:**
- `POST /api/v1/agents` accepts `AgentRegistration` and returns a public agent.
- `POST /api/v1/traces` accepts `TraceEnvelope` and returns `{ inserted, traceId }`.
- `POST /api/v1/keys` creates a key for the local default workspace.

- [ ] Parse bearer and `x-gauntlet-key` credentials at the route boundary.
- [ ] Return `401` for missing/invalid credentials, `400` for malformed payloads, and `409` for conflicting identity.
- [ ] Never return system prompts, endpoint credentials, or raw trace payloads.
- [ ] Add route-level validation tests using the existing Next route testing pattern.
- [ ] Run `pnpm test`.

### Task 4: MCP JSON-RPC control surface

**Files:**
- Create: `src/mcp/protocol.ts`
- Create: `src/mcp/server.ts`
- Create: `src/app/api/mcp/route.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- `handleMcpRequest(workspaceId: string, request: McpRequest): McpResponse`
- Tools: `list_agents`, `register_agent`, `run_suite`, `get_run`, `get_trace`.

- [ ] Validate JSON-RPC request IDs, method names, and tool arguments with `unknown` guards.
- [ ] Map tool failures to structured `isError: true` content without throwing for user input.
- [ ] Route every operation through existing stores and `startRun`; do not duplicate scoring.
- [ ] Add initialize, tools/list, tools/call, malformed request, auth, and tenant tests.
- [ ] Run `pnpm test` and `pnpm typecheck`.

### Task 5: Workspace signal dashboard

**Files:**
- Modify: `src/server/agent-store.ts`
- Modify: `src/app/api/agents/route.ts`
- Modify: `src/components/dashboard.tsx`
- Modify: `src/components/ui.tsx`
- Test: `test/agent-store.test.ts`

**Interfaces:**
- Dashboard agent DTO adds `source`, `lastTraceAt`, `latestTrace`, and `canRun`.

- [ ] Merge latest observed trace signal into each card without exposing raw payloads.
- [ ] Show black-box/observed/hybrid status and why observed-only agents cannot be run by endpoint.
- [ ] Link to a trace summary and preserve current suite selector, score delta, and polling behavior.
- [ ] Keep the current no-grid visual system and use borders only as data separators.
- [ ] Verify empty, observed-only, and hybrid cards in the browser.

### Task 6: SDK/CLI integration and docs

**Files:**
- Create: `src/sdk/client.ts`
- Modify: `src/cli/index.ts`
- Modify: `README.md`
- Create: `docs/examples/trace-ingest.ts`
- Test: `test/sdk-client.test.ts`

**Interfaces:**
- `createGauntletClient(input: { baseUrl: string; apiKey: string }): GauntletClient`
- `GauntletClient.registerAgent(input): Promise<PublicAgent>`
- `GauntletClient.ingestTrace(envelope): Promise<TraceReceipt>`

- [ ] Keep the client dependency-free and fetch-based so it can run in agent repos.
- [ ] Add `pnpm gauntlet key` and `pnpm gauntlet ingest --file` with explicit output.
- [ ] Document MCP client configuration, SDK usage, redaction, and the proof metrics.
- [ ] Run the full suite, build, typecheck, and mock benchmark.

### Task 7: Proof and release gate

**Files:**
- Modify: `bench/fixtures.ts`
- Modify: `bench/run.ts`
- Modify: `README.md`
- Test: `test/bench.test.ts`

- [ ] Add observed traces and planted defects to the benchmark without changing existing headline metrics silently.
- [ ] Report repeatability, false positives, mutation recall, and evaluator failure categories.
- [ ] Run `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm bench --mock --out /tmp/gauntlet-platform.json`, and `git diff --check`.
- [ ] Review the diff and list anything intentionally deferred.
