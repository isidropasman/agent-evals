# Commercial agent-evals core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Gauntlet's existing control plane into a reproducible commercial eval product with versioned datasets, explicit deterministic/model evaluators, normalized trace ingestion, and compatible execution surfaces.

**Architecture:** Keep the current synchronous SQLite adapter for local/CI compatibility and add the same entities to the shared Postgres adapter. Dataset versions are immutable manifests addressed by a content checksum; suites reference one dataset version and evaluator configuration. Replay selects a deterministic evaluator when possible and falls back to the existing model judge only when the case explicitly requires it. Existing regression cases and gate payloads remain valid, with new fields optional.

**Tech Stack:** TypeScript strict mode, Next.js App Router, Neon serverless Postgres, better-sqlite3, Inngest, Vitest, SDK, MCP, CLI.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-evals-platform-design.md`

**Status:** Implemented locally without commit, push or deploy. Dataset versions, deterministic replay, suite materialization, normalized batch ingestion, SDK/MCP/CLI compatibility, aggregate metrics and dashboard catalog visibility are covered by the current test suite.

## Global Constraints

- No `any`, no secrets in responses/logs, and all external input is validated at the API boundary.
- SQLite remains local/test-only; Postgres remains the production source of truth when `DATABASE_URL` is configured.
- Dataset versions and gate result records are immutable/idempotent; duplicate event IDs and duplicate version uploads must not duplicate evidence.
- Existing API, SDK, MCP, CLI, dashboard and GitHub Actions contracts remain backward compatible.
- No commit, push or deploy during execution.

---

### Task 1: Define evaluator contracts and deterministic execution

**Files:**
- Create: `src/engine/evaluators.ts`
- Modify: `src/engine/replay.ts`, `src/server/db.ts`, `src/server/shared-db.ts`
- Test: `test/evaluators.test.ts`, `test/replay.test.ts`

**Interfaces:**
- `EvaluatorDefinition = { type: "model" } | { type: "contains"; value: string; caseSensitive?: boolean } | { type: "regex"; pattern: string; flags?: string } | { type: "exact_json"; value: unknown }`.
- `evaluateDeterministic(definition, output): { ok: true; value: Verdict } | { ok: false; error: "invalid_evaluator"; message: string }`.
- `RegressionReplayCase.evaluator` is optional; omitted cases retain the current model-judge behavior.

- [x] Add schema validation for evaluator definitions and deterministic verdicts.
- [x] Add `evaluator_json` to both storage schemas with an idempotent column migration.
- [x] Make replay bypass the LLM for deterministic evaluators while preserving the current model judge path.
- [x] Test exact JSON, contains, regex, invalid patterns, and backward-compatible model cases.

### Task 2: Persist immutable datasets and suite manifests

**Files:**
- Create: `src/server/dataset-store.ts`, `src/server/shared-dataset-store.ts`
- Modify: `src/server/db.ts`, `src/server/shared-db.ts`, `src/server/http-input.ts`
- Test: `test/dataset-store.test.ts`, `test/shared-db.integration.test.ts`

**Interfaces:**
- `DatasetItemInput = { input: unknown; expectedOutput?: unknown; evaluator?: EvaluatorDefinition; metadata?: Record<string,string> }`.
- `createDatasetVersion(workspaceId, name, version, items)` returns `{ id, checksum, itemCount }` and rejects the same name/version with a different checksum.
- `listDatasetVersions(workspaceId)` returns summaries only; item payloads are returned only by an authenticated detail call.

- [x] Add `eval_datasets`, `eval_dataset_versions`, and `eval_dataset_items` tables in SQLite and Postgres.
- [x] Compute a canonical SHA-256 checksum over ordered normalized items before insertion.
- [x] Enforce unique `(workspace_id, name, version)` and immutable item rows.
- [x] Add storage tests for idempotent re-upload, conflicting checksum, ordering, and workspace isolation.

### Task 3: Add suite manifests and connect them to gates

**Files:**
- Create: `src/server/suite-store.ts`, `src/server/shared-suite-store.ts`
- Modify: `src/server/http-input.ts`, `src/server/gate-runner.ts`, `src/server/durable-gates.ts`, `src/server/gate-worker.ts`
- Test: `test/suite-store.test.ts`, `test/gate-runner.test.ts`, `test/durable-gates.test.ts`

**Interfaces:**
- `SuiteManifest = { name: string; version: string; datasetVersionId: string; maxCases?: number; concurrency?: number }`.
- `RegressionGateInput.suiteId?: string` is optional; `caseIds` remains authoritative when present.
- Selecting a suite resolves its immutable dataset version and produces a stable ordered case set before a gate starts.

- [x] Persist suite manifests with unique `(workspace_id, name, version)` and a dataset-version foreign key.
- [x] Extend gate input validation with mutually compatible `suiteId` and `caseIds` semantics.
- [x] Resolve suite cases deterministically from materialized dataset cases and preserve old case-only gates.
- [x] Test suite materialization and stable dataset ordering; async selection uses the same suite-scoped case filter.

### Task 4: Normalize and batch trace ingestion

**Files:**
- Create: `src/server/trace-normalizer.ts`
- Modify: `src/server/http-input.ts`, `src/server/trace-store.ts`, `src/server/shared-trace-store.ts`, `src/app/api/v1/traces/route.ts`, `src/sdk/client.ts`, `src/mcp/server.ts`
- Test: `test/trace-normalizer.test.ts`, `test/http-routes.test.ts`, `test/sdk-client.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- `normalizeTraceEnvelope(raw)` trims IDs, bounds payload sizes, redacts sensitive keys recursively, and returns a canonical `TraceEnvelope`.
- `POST /api/v1/traces/batch` accepts `{ traces: TraceEnvelope[] }`, returns `{ accepted, duplicates, rejected }`, and never exposes payloads.
- `GauntletClient.ingestTraces` mirrors the batch endpoint; `ingestTrace` remains unchanged.

- [x] Move shared redaction/normalization rules into one module used by SQLite and Postgres paths.
- [x] Add batch limits and per-item validation with partial success semantics.
- [x] Preserve event-id deduplication and audit one batch action without storing transcript contents in audit metadata.
- [x] Add SDK/MCP/API coverage for batch ingestion and malformed item handling.

### Task 5: Expose compatible API, SDK, MCP, CLI and dashboard capabilities

**Files:**
- Create: `src/app/api/v1/datasets/route.ts`, `src/app/api/v1/datasets/[id]/route.ts`, `src/app/api/v1/suites/route.ts`
- Modify: `src/sdk/client.ts`, `src/mcp/server.ts`, `src/cli/gate.ts`, `src/components/dashboard.tsx`, `README.md`, `docs/operations/production.md`
- Test: `test/http-routes.test.ts`, `test/sdk-client.test.ts`, `test/mcp.test.ts`, `test/cli.test.ts`

- [x] Add authenticated dataset upload/list/detail routes with RBAC and rate limits.
- [x] Add suite list/create routes and an MCP representation without removing current built-in suite names.
- [x] Make the SDK/CLI async gate path poll `202` responses while keeping synchronous `201` behavior.
- [x] Show dataset checksum and suite version in the dashboard catalog; evaluator type remains visible in dataset detail/API responses without exposing item payloads in the catalog.
- [x] Document the reproducibility contract and payload limits.

### Task 6: Observability, security review and release validation

**Files:**
- Create: `src/app/api/metrics/route.ts`, `test/metrics.test.ts`
- Modify: `src/server/audit.ts`, `src/server/rate-limit.ts`, `docs/operations/production.md`, `docs/operations/backup-recovery.md`

- [x] Add authenticated aggregate metrics for ingestion, evaluator outcomes, queue state, and gate regressions without raw payloads.
- [x] Verify new dataset, suite, batch and metrics routes for workspace scoping, RBAC, rate limits and no-store responses; audit coverage is applied to mutations.
- [x] Run the local release matrix plus real Neon storage, integration schema, backup/restore rehearsal and browser smoke; Inngest Cloud remains externally blocked by missing credentials.
- [x] Run no-secret/no-`any`/no-debug-log scans over the changed implementation and report external Inngest/GitHub blockers without bypassing them.
