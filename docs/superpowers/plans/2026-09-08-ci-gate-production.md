# CI Gate and Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn replayable regression cases into a multi-case CI gate with persisted version baselines, GitHub status checks, and production-safe operational limits.

**Architecture:** The gate service selects workspace-scoped cases, snapshots the previous completed gate as the baseline, replays cases through the existing connector/judge path with bounded concurrency, and persists one immutable gate result plus one result per case. The CLI calls the authenticated gate API, emits stable JSON and exit codes, and GitHub Actions turns that exit code into a native check run. The dashboard uses the same local service and exposes the latest gate without exposing inputs or outputs.

**Tech Stack:** Next.js App Router, TypeScript strict mode, SQLite via better-sqlite3, existing replay engine, fetch SDK, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-evals-platform-design.md`

## Global Constraints

- Keep all gate and case records workspace-scoped.
- Reuse `executeRegressionCase`, `sendToAgent`, and `judgeConversation`; do not create a second evaluator.
- Baseline comparison is against the previous completed gate, never against an in-flight or partial gate.
- A case is passing only when replay and judgment both succeed; `error` fails the gate and is not converted into `fail`.
- Gate concurrency is bounded to 4 by default and cannot exceed 8.
- Public reports contain statuses, counts, versions, latency and verdict metadata only; never inputs, outputs, credentials or system prompts.
- GitHub Actions receives credentials only through secrets and does not print them.
- Do not commit or push during implementation.

---

### Task 1: Persist immutable gate history and baseline data

**Files:**
- Modify: `src/server/db.ts`
- Create: `src/server/gate-store.ts`
- Test: `test/gate-store.test.ts`

**Interfaces:**
- `insertRegressionGateRun(input)` creates a run with `running` status.
- `getLatestCompletedRegressionGate(workspaceId)` returns the previous completed run.
- `insertRegressionGateCaseResult(input)` stores one immutable case result.
- `completeRegressionGateRun(workspaceId, id, result)` records final counts and status.

- [x] Add `regression_gate_runs` and `regression_gate_case_results` tables with indexes and migration-safe creation.
- [x] Implement typed records and hydration functions without returning raw case input.
- [x] Make baseline lookup ignore `running` and partial gates.
- [x] Test first gate, second gate baseline version, workspace isolation and immutable case results.

### Task 2: Implement bounded multi-case gate execution

**Files:**
- Create: `src/server/gate-runner.ts`
- Modify: `src/server/http-input.ts`
- Test: `test/gate-runner.test.ts`

**Interfaces:**
- `runWorkspaceRegressionGate(workspaceId, input)` returns a discriminated result with `status`, `version`, `baselineVersion`, counts, regressions and case results.
- Input accepts optional `caseIds`, `version` and `concurrency`.

- [x] Select all workspace cases by default and reject unknown or cross-workspace case IDs before starting.
- [x] Capture the previous completed gate and its per-case statuses before replaying anything.
- [x] Replay cases through `executeRegressionCase` using a pool capped at 8 workers.
- [x] Mark `regression` when a previously passing case no longer passes; fail the gate for any failed or errored current case.
- [x] Persist each result and finalize the gate even when one replay errors.
- [x] Test pass, fail, error, baseline regression, no cases, invalid case IDs and concurrency ceiling.

### Task 3: Add authenticated gate API and SDK contract

**Files:**
- Create: `src/app/api/v1/gates/route.ts`
- Create: `src/app/api/cases/gate/route.ts`
- Modify: `src/sdk/client.ts`
- Test: `test/gate-routes.test.ts`
- Modify: `test/sdk-client.test.ts`

**Interfaces:**
- `POST /api/v1/gates` accepts `{caseIds?, version?, concurrency?}` and returns a public gate report.
- `GET /api/v1/gates` returns recent public gate reports.
- SDK `runGate(input?)` and `listGates()` mirror those endpoints.

- [x] Require workspace credentials on authenticated routes and use the default workspace only on local routes.
- [x] Validate case IDs, version length and concurrency at the HTTP boundary.
- [x] Return 201 for a newly started/completed synchronous gate and stable error statuses for invalid state.
- [x] Test auth, selection, report shape and no raw payload leakage.

### Task 4: Ship the CI command and native GitHub status check

**Files:**
- Modify: `src/cli/index.ts`
- Create: `.github/workflows/agent-evals.yml`
- Modify: `README.md`
- Modify: `test/cli.test.ts`

**Interfaces:**
- `gauntlet gate [--case-id <id> ...] [--version <version>] [--concurrency <n>] [--output <path>] --api-key <key> [--base-url <url>]`.
- Exit code `0` means all selected cases passed, `1` means a gate failure/regression, `2` means configuration or transport failure.
- JSON output includes `status`, `version`, `baselineVersion`, counts, regressions and case results.

- [x] Add repeated `--case-id` parsing, safe version defaults from `GITHUB_SHA`, output file writing and concise terminal output.
- [x] Add a GitHub workflow using `GAUNTLET_URL` and `GAUNTLET_API_KEY` secrets, upload the report on every outcome, and let the job conclusion become the required check.
- [x] Document branch-protection setup, baseline semantics, fork limitations and exit codes.
- [x] Test flag validation and exit behavior without making network calls.

### Task 5: Expose gate status in the local product

**Files:**
- Modify: `src/components/dashboard.tsx`
- Create: `src/app/api/gates/route.ts`
- Test: `test/dashboard-gate.test.ts`

**Interfaces:**
- The dashboard lists the latest gate version, baseline, pass/fail/error counts and regressions.
- A `run gate` action executes all local cases and refreshes the case statuses.

- [x] Add a single bounded gate action with disabled/loading/error states.
- [x] Render baseline comparison as data, not a decorative score, and keep mobile horizontal tables usable.
- [x] Do not render case input, agent output, system prompt or stored secrets.

### Task 6: Production verification and hardening review

**Files:**
- Modify: `docs/superpowers/plans/2026-09-08-ci-gate-production.md`
- Modify: `README.md`

- [x] Run full tests, typecheck, build, diff check and mock benchmark.
- [x] Exercise authenticated and local routes, CLI help, responsive dashboard and console errors.
- [x] Review SSRF, secret handling, SQLite concurrency, timeout behavior and Vercel Node.js runtime assumptions.
- [x] Record remaining production tradeoffs honestly: durable external DB/queue, auth provider and long-running gate workers remain the next hosted-scale boundary.
