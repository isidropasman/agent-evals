# Regression Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an observed agent trace into a redacted, replayable regression case that can be executed against a configured endpoint and surfaced as a durable pass/fail signal.

**Architecture:** A regression case is a workspace-scoped snapshot of one trace's input and assertion intent. The replay path uses the existing connector and binary judge, persists only the verdict and run metadata, and never returns stored prompts, outputs, or credentials through summary APIs. Promotion, listing, and replay are available through the authenticated API and MCP; the local dashboard gets a safe promotion action for local workspaces.

**Tech Stack:** Next.js App Router, TypeScript strict mode, SQLite via better-sqlite3, existing connector/judge engine, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-evals-platform-design.md`

## Global Constraints

- Keep all records workspace-scoped.
- Keep raw payloads out of public summaries; stored payloads must use the existing redaction function.
- Use discriminated unions for expected domain errors.
- Do not add a second connector or scoring implementation.
- A replay without an input, endpoint, or valid judge result is not a passing case.
- Do not commit or push during implementation.

### Task 1: Persist and validate regression cases

**Files:**
- Modify: `src/server/db.ts`
- Create: `src/server/regression-store.ts`
- Modify: `src/server/http-input.ts`
- Test: `test/regression-store.test.ts`

**Interfaces:**
- `createRegressionCase(workspaceId, input)` returns a discriminated result for success, missing trace input, missing assertion, or duplicate source trace.
- `listRegressionCases(workspaceId)` returns public case summaries only.
- `getRegressionCase(workspaceId, caseId)` returns the redacted replay input internally.
- `recordRegressionReplay(workspaceId, caseId, result)` persists pass/fail/error metadata.

- [x] Add `regression_cases` with workspace, agent, source trace, redacted input JSON, assertion name/detail, expected pass, last replay status and timestamps.
- [x] Add strict parsers for promote-case and replay query inputs.
- [x] Promote only traces with a user input and assertion; use the assertion as the replay success criterion.
- [x] Test workspace isolation, duplicate promotion, redaction, and replay metadata updates.

### Task 2: Add the replay engine

**Files:**
- Create: `src/engine/replay.ts`
- Test: `test/replay.test.ts`

**Interfaces:**
- `runRegressionReplay(input, providers)` returns `{ ok: true, value: { passed, verdict, latencyMs } }` or an `EngineResult` error.
- The replay constructs one transcript from the case input and uses `judgeConversation` with the case assertion as its scenario criterion.

- [x] Send the stored input through `sendToAgent` with a fresh session id.
- [x] Judge the resulting transcript with the existing binary judge and a minimal rubric.
- [x] Keep connector failures distinct from judge failures and expose latency without exposing output.
- [x] Test pass, fail, connector error, and malformed judge results with fake providers/fetch.

### Task 3: Expose authenticated API and MCP controls

**Files:**
- Create: `src/app/api/v1/cases/route.ts`
- Create: `src/app/api/v1/cases/from-trace/route.ts`
- Create: `src/app/api/v1/cases/[id]/replay/route.ts`
- Modify: `src/mcp/protocol.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/regression-routes.test.ts`
- Test: `test/mcp.test.ts`

**Interfaces:**
- `POST /api/v1/cases/from-trace` promotes `{ agentId, traceId, name? }`.
- `GET /api/v1/cases` lists workspace-scoped summaries.
- `POST /api/v1/cases/:id/replay` runs one case and returns only verdict metadata.
- MCP tools: `list_cases`, `promote_trace`, `replay_case`.

- [x] Require workspace credentials on every v1 case route.
- [x] Verify agent ownership and endpoint configuration before replay.
- [x] Return 201 for a newly promoted case, 200 for a replay result, and typed 4xx errors for invalid state.
- [x] Ensure MCP cannot read or replay another workspace's case.

### Task 4: Integrate local dashboard, SDK, and CLI

**Files:**
- Create: `src/app/api/cases/from-trace/route.ts`
- Modify: `src/components/dashboard.tsx`
- Modify: `src/sdk/client.ts`
- Modify: `src/cli/index.ts`
- Modify: `README.md`

**Interfaces:**
- The dashboard can promote a trace with an assertion and displays the latest replay status.
- SDK methods: `listCases`, `promoteTrace`, `replayCase`.
- CLI command: `gauntlet replay --case-id <id> --api-key <key> [--base-url <url>]`.

- [x] Add a safe promote action to observed-feed rows.
- [x] Add replay status to the case summary without rendering raw payloads.
- [x] Document the end-to-end trace-to-gate workflow and its production limits.

### Task 5: Verify the complete loop

**Files:**
- Modify: `test/http-routes.test.ts`
- Modify: `test/sdk-client.test.ts`
- Modify: `test/cli.test.ts`

- [x] Test promote → list through authenticated route boundaries; replay engine and route guards are covered separately.
- [x] Run the full test suite, typecheck, build, diff check, and mock benchmark.
- [x] Check the dashboard at desktop and mobile widths with no console errors.
