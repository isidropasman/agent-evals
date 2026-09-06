# Product Usability Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the time and friction between opening Gauntlet, connecting an agent, and acting on an evaluation result.

**Architecture:** Improve the existing web shell without changing evaluation semantics. The browser keeps a non-secret onboarding draft, preflight returns one observable latency measurement, fixes expose a clipboard action, and the run-history empty state points to the next useful action. API keys and endpoint tokens never enter browser draft storage.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Node fetch, Vitest, gstack browser smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-01-readme-evidence-design.md`

## Global Constraints

- Do not change engine scoring, scenario generation, judge behavior, or protocol contracts.
- Do not persist API keys or endpoint auth tokens in browser storage.
- Keep the existing Spanish UI copy and dark visual system.
- Add no dependencies.
- Every new user-visible value must come from current runtime state, not fabricated metrics.

---

### Task 1: Persist a safe onboarding draft

**Files:**
- Modify: `src/components/onboarding.tsx`
- Test: existing `pnpm typecheck`, `pnpm test`, and browser reload smoke test

**Interfaces:**
- Consumes: existing onboarding state fields.
- Produces: `gauntlet:onboarding-draft` browser storage containing only non-secret form fields.

- [ ] **Step 1: Define the draft type and storage guard**

Add a local `OnboardingDraft` interface for agent name, client name, endpoint URL, protocol, auth type, header name, mode, prompt, agent family, tools visibility, tools JSON, scenario count, and `k`. Add a type guard for parsed `unknown` data; reject malformed storage instead of casting it blindly.

- [ ] **Step 2: Load and save the draft**

Add a hydration flag and two effects. The first reads `localStorage` after mount and restores the guarded fields. The second serializes the fields after hydration. Never include `authToken`; clear the draft after `/api/runs` returns a run id.

- [ ] **Step 3: Verify persistence and secrecy**

Run `pnpm typecheck` and `pnpm test`. In the browser, fill the name, endpoint, prompt, and tools, reload, and verify they return. Inspect `localStorage` and verify no value entered in the Bearer/header token field appears.

### Task 2: Make connection testing informative

**Files:**
- Modify: `src/app/api/preflight/route.ts`
- Modify: `src/components/onboarding.tsx`
- Test: `test/preflight.test.ts` if the response contract is covered there; otherwise browser smoke plus typecheck

**Interfaces:**
- Consumes: existing `probeAgent` result.
- Produces: successful preflight JSON with `latencyMs: number` alongside `reply` and `anthropicConfigured`.

- [ ] **Step 1: Measure the probe at the API boundary**

Capture `performance.now()` immediately before `probeAgent` and return a rounded non-negative `latencyMs` on success. Do not add timing to engine reports or use it for scoring.

- [ ] **Step 2: Render the measurement**

Extend the success state in `Onboarding` to carry `latencyMs`. Show `conexión OK · respuesta en N ms` next to the existing reply, using the server-provided value.

- [ ] **Step 3: Verify the success contract**

Run the preflight tests and use the real demo endpoint from the browser. Expected: successful response displays a numeric latency; existing failure messages remain unchanged.

### Task 3: Turn fixes into an immediate action

**Files:**
- Modify: `src/components/run-view.tsx`
- Test: `pnpm typecheck`, `pnpm test`, and browser interaction against an existing report fixture if available

**Interfaces:**
- Consumes: existing `PromptFix.diff`.
- Produces: a client-only clipboard action with success and failure feedback.

- [ ] **Step 1: Add a copy control per fix**

Create a small local `CopyFixButton` client component in `run-view.tsx`. On click, call `navigator.clipboard.writeText(diff)`, show `copiado` for a short-lived state, and show `no se pudo copiar` when the browser rejects the operation. Do not mutate the report.

- [ ] **Step 2: Place it beside the fix heading**

Render the control in the existing fix header so the user can copy the exact patch without selecting a `<pre>` block manually.

- [ ] **Step 3: Verify the action**

Run `pnpm typecheck` and `pnpm test`. Confirm the control has a clear label and changes state after a successful clipboard write in a browser that supports it.

### Task 4: Make empty history useful

**Files:**
- Modify: `src/app/runs/page.tsx`
- Test: `pnpm typecheck`, `pnpm build`, and browser smoke on `/runs`

**Interfaces:**
- Consumes: existing `listRuns()` empty result.
- Produces: an empty state with direct links to start a run and inspect the measured benchmark.

- [ ] **Step 1: Replace the dead-end empty copy**

Explain that no run exists on this local workspace, then render `nueva corrida` as the primary link and `ver benchmark` as the secondary link. Keep the existing layout and route behavior.

- [ ] **Step 2: Verify the empty state**

Run `pnpm build` and open `/runs` with an empty database. Expected: both links are visible and point to `/` and `/benchmark`.

### Final verification

- [ ] Run `git diff --check`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Exercise onboarding draft restore, preflight latency, demo `10 × 1`, and the history empty state with gstack browser smoke tests.
- [ ] Confirm the diff contains no API keys, tokens, or unrelated engine changes.

### Self-review

- This milestone is deliberately browser-shell only; it does not pretend to solve reruns or cross-run comparisons yet.
- The next product slice should add persisted run inputs and “rerun failed scenarios” after this baseline is stable.
