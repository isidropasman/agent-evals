# Agent Test Suites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fleet dashboard into a real agent test console with explicit, repeatable suites for safety, reliability and tool behavior, plus regression deltas between runs.

**Architecture:** Keep the existing `runEval` orchestration and judge as the only execution path. Add a typed suite definition that changes scenario mix and generation guidance, persist the selected suite inside `RunReport`, and calculate score deltas from the agent's last scored run. The dashboard selects a suite and sends it to the existing single/batch APIs.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, existing engine prompts, SQLite-backed run reports, Vitest.

**Spec:** Derived from the Autonoma comparison researched on 2026-09-07: preserve Gauntlet's black-box boundary while adding explicit coverage plans and regression-aware review.

## Global Constraints

- Reuse `runEval`; do not create a second runner for suite-specific behavior.
- Suites only change test intent and scenario mix; scoring, `pass^k`, judge handling and certification gates remain identical.
- Keep the four suites bounded and explicit; no arbitrary user prompt injection into the engine.
- Existing callers that omit `suite` continue to run the balanced suite.
- Do not add charting or external dependencies.

---

### Task 1: Define suite contracts and generation guidance

**Files:**
- Create: `src/engine/suites.ts`
- Modify: `src/engine/types.ts`
- Modify: `src/engine/scenarios.ts`
- Modify: `src/engine/tasks.ts`
- Test: `test/suites.test.ts`

**Interfaces:**
- `TestSuite = "balanced" | "safety" | "reliability" | "tools"`.
- `SUITE_DEFINITIONS: Record<TestSuite, { label, description, mix, guidance }>`.
- `isTestSuite(value: unknown): value is TestSuite`.
- `suiteGuidance(suite: TestSuite, hasTools: boolean): string`.
- `RunConfig.suite` and `RunReport.suite` are required internally; defaults use `balanced`.

- [x] **Step 1: Write failing suite contract tests**

Test that every suite has a non-empty label, description and guidance; suite mixes add to the requested scenario count after scaling; unknown values are rejected; and the tools suite calls out tool behavior only when tools exist.

- [x] **Step 2: Implement definitions and defaults**

Add four explicit suites:

| Suite | Focus | Default mix |
| --- | --- | --- |
| `balanced` | broad product signal | 40% happy / 30% edge / 30% adversarial |
| `safety` | injection, scope, privacy, hallucination and refusal | 25% / 25% / 50% |
| `reliability` | ambiguity, recovery, consistency and boundary values | 50% / 40% / 10% |
| `tools` | tool selection, untrusted results, malformed arguments and loops | 25% / 25% / 50% |

Use `balanced` when a caller omits the field.

- [x] **Step 3: Thread suite guidance into generation**

Append `suiteGuidance(config.suite, hasTools)` to both conversational and task generation prompts. The guidance must tell the model what to prioritize without changing the judge rubric or execution code.

- [x] **Step 4: Run suite tests**

Run `pnpm vitest run test/suites.test.ts` and confirm all suite contract tests pass.

### Task 2: Add suite selection and regression deltas to server APIs

**Files:**
- Modify: `src/server/agent-store.ts`
- Modify: `src/server/run-store.ts`
- Modify: `src/app/api/agents/[id]/run/route.ts`
- Modify: `src/app/api/agents/run-all/route.ts`
- Modify: `src/app/api/runs/route.ts`
- Test: `test/agent-store.test.ts`

**Interfaces:**
- `runConfigForPreset(scenarioCount, k, suite = "balanced")` returns a suite-aware config.
- `AgentRunSummary` includes `suite` and `scoreDelta` stays on `AgentDashboardRow`.
- Public API accepts `suite` and rejects unknown suite values.

- [x] **Step 1: Extend report and run input metadata**

Add the suite to `RunReport` and have `runEval` copy the resolved config suite into every report. Existing reports without the field deserialize as `null` in dashboard summaries.

- [x] **Step 2: Make server presets suite-aware**

Use the selected suite's mix percentages when building the config. Keep `scenarioCount` and `k` validation unchanged.

- [x] **Step 3: Calculate regression deltas**

For each agent, find the latest and previous runs with a non-null score. Return `scoreDelta = latest.score - previous.score`, or `null` when there is no comparison. Do not calculate a delta across different suite types; this prevents comparing a safety run with a balanced run as if they were the same test.

- [x] **Step 4: Test deterministic deltas and validation**

Extend store tests for same-suite positive/negative deltas and no delta across suite changes. Test suite input guards independently from the UI.

### Task 3: Build test-console controls

**Files:**
- Modify: `src/components/dashboard.tsx`
- Modify: `src/components/run-view.tsx`
- Modify: `README.md`

**Interfaces:**
- Dashboard sends `{ scenarioCount, k, suite }` to both run endpoints.
- Dashboard cards show suite, score delta and a plain-language focus label.
- Empty state and README explain when to use each suite and why deltas are suite-scoped.

- [x] **Step 1: Add suite selector**

Add a controlled selector beside `correr todos`; default to `balanced`, show all four labels, and keep the quick preset at `10 × 1`.

- [x] **Step 2: Send suite through run actions**

Pass the selected suite to run-one and run-all requests. Keep the current duplicate-run guard and two-agent scheduler unchanged.

- [x] **Step 3: Render evidence-aware card state**

Show suite label, `+Δ`/`−Δ` only for same-suite comparisons, and a link to the full report. A missing comparison must render as `baseline pendiente`, not as a fabricated zero.

- [x] **Step 4: Document the test matrix**

Add a README table with suite intent, example failure classes, and the honest boundary: suites still test the agent endpoint; they do not verify that a downstream production side effect actually occurred.

### Task 4: Verify and record the product boundary

**Files:**
- Modify: `docs/superpowers/plans/2026-09-07-agent-test-suites.md`

- [x] **Step 1: Run checks**

Run `git diff --check`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm bench --mock --out /tmp/gauntlet-agent-suites.json`.

- [x] **Step 2: Browser smoke**

Opened `/dashboard`, confirmed the selector defaults to balanced, changed it to safety, and verified the API accepts safety while rejecting an unknown suite. No credentialed run was started.

- [x] **Step 3: Record follow-ups**

Document that the next Autonoma-inspired layer is a codebase/preview adapter plus environment factory for agents whose correctness depends on real application state. Do not claim that layer is implemented by suites.

## Why this improves the product

Autonoma's useful lesson is lifecycle ownership: a test plan needs an explicit intent, execution evidence and a way to notice drift. These suites add the intent and regression comparison without weakening Gauntlet's stronger property: every suite still reaches the same black-box engine, tool loop, judge and certification gates.
