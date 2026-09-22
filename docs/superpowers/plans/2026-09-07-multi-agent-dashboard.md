# Multi-Agent Evaluation Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one local Gauntlet workspace register many agents, run one or all of them from a dashboard, and compare their latest evidence without duplicating the evaluation engine.

**Architecture:** Add an `agents` registry in SQLite and an optional `agent_id` foreign-key reference on runs. The existing `runEval` remains the only scoring path. A small bounded batch scheduler launches at most two agent runs at once while each run retains the engine's internal concurrency and cancellation behavior. The dashboard reads aggregate summaries from the server and never receives stored auth tokens or full system prompts.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, better-sqlite3, Vitest, existing Tailwind/CSS system.

**Spec:** This plan is the executable spec for the multi-agent dashboard requested on 2026-09-07; it extends the evidence and usability work in `docs/superpowers/specs/2026-09-01-readme-evidence-design.md`.

## Global Constraints

- Reuse `runEval`; do not fork scoring, judging, scenario generation, or report formats.
- Batch concurrency is capped at `2` agent runs; the cap is covered by a deterministic unit test.
- Agent auth tokens remain server-side in local SQLite and are never included in dashboard JSON.
- Existing runs and existing `/runs` behavior remain compatible; `agent_id` is nullable for historical rows.
- Do not add a charting dependency; render the small score trend with inline SVG.
- Keep the existing Spanish UI and dark visual system.

---

### Task 1: Add the agent registry and run association

**Files:**
- Modify: `src/server/db.ts`
- Create: `src/server/agent-store.ts`
- Modify: `src/server/run-store.ts`
- Test: `test/agent-store.test.ts`

**Interfaces:**
- Produces `AgentRecord` with id, display config, and server-only auth fields.
- Produces `AgentDashboardRow` with latest score/status and a bounded score history, excluding prompt and tokens.
- Extends `RunRow` and `createRun` with nullable `agentId`.

- [x] **Step 1: Define the persisted schema**

Create an `agents` table with `id`, `name`, `client_name`, `endpoint_url`, `protocol`, `auth_type`, `auth_token`, `auth_header_name`, `system_prompt`, `agent_family`, `mode`, `tools_json`, `active`, `created_at`, and `updated_at`. Add `agent_id TEXT` to `runs` through an idempotent startup migration so databases created before this feature still open.

- [x] **Step 2: Implement typed registry operations**

Implement create, get, update-active, and list operations in `agent-store.ts`. Parse `tools_json` at the server boundary and convert an agent record into the existing `StartRunInput` shape. Keep token-bearing records private to server code.

- [x] **Step 3: Implement dashboard aggregation**

Return one row per active agent with the latest run status, latest score/certification, last-run timestamp, and up to the last eight scored runs ordered oldest-to-newest. Use `agent_id` for joins and fall back to no agent association for historical runs.

- [x] **Step 4: Test persistence and aggregation**

Verify the public projection and deterministic aggregation with pure unit tests; verify the SQLite-backed API path with a live registration request. The test suite confirms dashboard rows omit prompt/token fields and select the newest run deterministically. Full isolated persistence coverage remains a follow-up once the database abstraction supports injectable connections.

### Task 2: Add bounded batch scheduling

**Files:**
- Create: `src/server/batch.ts`
- Modify: `src/server/run-store.ts`
- Test: `test/batch.test.ts`

**Interfaces:**
- `startBoundedBatch<T>(tasks, maxConcurrent, launch)` invokes async `launch(task, index)` while never exceeding the cap and resolves when every task settles.
- `startBatchRun` creates all run rows immediately, then launches their existing `runEval` execution through the scheduler.

- [x] **Step 1: Write the scheduler test**

Create six asynchronous fake tasks with a maximum concurrency of two. Track active and maximum-active counts, resolve each task after a short timer, and assert all six finish with `maxActive === 2`.

- [x] **Step 2: Implement the scheduler**

Use a closure with `nextIndex`, `active`, and a single `pump` function. Start only as many tasks as capacity allows; call `pump` from each `done`. Reject invalid caps instead of silently running unbounded work.

- [x] **Step 3: Connect it to run execution**

Refactor the existing fire-and-forget body into a private `executeRun` promise. Keep single-run callers unchanged and use `startBatchRun` for dashboard batches. Persist queued rows before launching so returned ids are immediately addressable.

### Task 3: Expose registry and run APIs

**Files:**
- Create: `src/app/api/agents/route.ts`
- Create: `src/app/api/agents/[id]/run/route.ts`
- Create: `src/app/api/agents/run-all/route.ts`
- Test: `test/agent-api.test.ts` if the existing API test harness supports route invocation; otherwise verify with build and browser requests

**Interfaces:**
- `GET /api/agents` returns `{ agents: AgentDashboardRow[] }`.
- `POST /api/agents` accepts an agent configuration, validates endpoint policy and tools, and returns `{ agent: publicAgent }`.
- `POST /api/agents/:id/run` returns `{ runId }`.
- `POST /api/agents/run-all` accepts optional `{ agentIds?: string[] }` and returns `{ runIds, queued }`.

- [x] **Step 1: Validate agent input at the API boundary**

Require name, endpoint, and non-empty system prompt. Reuse `assertAllowedUrl`, the existing protocol/auth enums, and the existing tools shape validation. Reject inactive or unknown ids with clear 4xx responses.

- [x] **Step 2: Implement public serialization**

Return name, endpoint, protocol, active state, latest run summary, and score history. Never serialize `system_prompt`, `auth_token`, or the complete tools payload in dashboard responses.

- [x] **Step 3: Start one and all agents**

Build `StartRunInput` from server-side records and invoke `startRun` or `startBatchRun`. For run-all, use all active agents by default, preserve requested order when `agentIds` is supplied, and return ids even when some agents are already running only if the API explicitly rejects duplicates.

### Task 4: Build the dashboard experience

**Files:**
- Create: `src/app/dashboard/page.tsx`
- Create: `src/components/dashboard.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/runs/page.tsx`
- Test: gstack browser smoke plus `pnpm typecheck` and `pnpm build`

**Interfaces:**
- Consumes `GET /api/agents` and the run endpoints.
- Produces a dashboard with aggregate health, per-agent cards, score trend, register-agent form, run-one action, and run-all action.

- [x] **Step 1: Add navigation and empty state**

Add `dashboard` links to the home and history headers. The dashboard empty state must explain that agents are stored locally and provide the first registration action plus a link to the benchmark.

- [x] **Step 2: Render aggregate and per-agent metrics**

Show total agents, currently running, latest passing count, and last-evaluation time. Each agent card shows endpoint, protocol, latest score, certification state, last-run status, a score trend SVG, and `evaluar`.

- [x] **Step 3: Add registration and run-all controls**

Create a compact form for name, endpoint, protocol, auth mode/token, model family, and system prompt. Keep token inputs password-type. After successful registration refresh the dashboard. Run-all shows queued/running/completed counts and polls the dashboard while any selected run is active.

- [x] **Step 4: Verify responsive interaction**

Used the browser against an empty local database to verify the empty state and registration form, and used live requests to verify registration, public DTO redaction, and the no-active-agent batch response. The full run-all interaction requires provider credentials; the bounded scheduler is covered independently by unit tests.

### Task 5: Explain the technical advantage and verify the release

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-07-multi-agent-dashboard.md`

- [x] **Step 1: Document the architecture**

Add a dashboard section with a Mermaid data-flow diagram and concrete explanations: one scoring engine, server-side agent registry, bounded batch scheduling, stable agent/run identity, and public/private DTO separation. State the local SQLite and single-instance limits.

- [x] **Step 2: Complete plan checkboxes**

Update this plan with the actual verification results and record any follow-up such as multi-instance queue persistence or encrypted credential storage separately from the shipped behavior.

- [x] **Step 3: Run the full verification**

Ran `git diff --check`, `pnpm test` (92 passing), `pnpm typecheck`, `pnpm build`, and `pnpm bench --mock --out /tmp/gauntlet-dashboard-smoke.json`. No engine scoring files changed. The live API registration used a throwaway token and the row was removed from the local SQLite database after verification; no secret was written to tracked files.

## Why this is technically superior

The dashboard is not just a table over `/runs`. It makes agent identity explicit, turns “run all” into a controlled scheduler instead of a request fan-out, keeps credentials behind server-only DTOs, and preserves the same evaluator semantics for single and batch runs. That gives comparable evidence across agents without creating a second evaluation path that could drift from the engine.
