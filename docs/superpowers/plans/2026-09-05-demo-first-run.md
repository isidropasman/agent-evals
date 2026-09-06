# Demo First Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bundled demo a safer first run by selecting the small evaluation preset and clearly showing that the demo configuration is preloaded.

**Architecture:** Keep the change inside the existing client-side onboarding state. Loading the demo will set the already-supported `10 × 1` controls and a local `demoLoaded` flag; step three renders a non-blocking notice beside the run configuration. No engine, API, scoring, or persistence contracts change.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Vitest, gstack browser smoke test.

**Spec:** `docs/superpowers/specs/2026-09-01-readme-evidence-design.md`

## Global Constraints

- Do not change the evaluation engine or its scoring semantics.
- Preserve the user's ability to change the demo preset before submitting.
- Keep the UI copy in the existing Spanish product language.
- Do not add dependencies or store new persisted state.

---

### Task 1: Make the demo preset safe for a first run

**Files:**
- Modify: `src/components/onboarding.tsx:14-105, 328-374`
- Test: manual gstack browser flow plus existing `pnpm typecheck`, `pnpm test`, and `pnpm build`

**Interfaces:**
- Consumes: existing `loadDemo`, `scenarioCount`, `k`, and step-three render.
- Produces: demo loading that selects `10 × 1` and a visible review notice.

- [ ] **Step 1: Update the demo state contract**

Add `demoLoaded` as a local boolean state initialized to `false`. In `loadDemo`, set the supported first-run values with `setScenarioCount(10)` and `setK(1)`, then set `demoLoaded` to `true` before moving to step three.

- [ ] **Step 2: Render the review notice**

At the top of step three, render a bordered, non-blocking notice only when `demoLoaded` is true. It must say that the demo is preloaded with `10 escenarios × 1 corrida` and that the values can be changed before running.

- [ ] **Step 3: Run the focused verification**

Run `pnpm typecheck` and `pnpm test`. Expected: typecheck succeeds and all existing tests pass.

- [ ] **Step 4: Verify the interaction in the running app**

Start the app with `pnpm dev`, open `http://localhost:3000`, activate `probar con agente demo`, and verify that step three shows the notice, `10` is selected for scenarios, `1` is selected for `k`, and the estimate reflects 10 conversations. Verify that selecting `50` and `4` still works.

- [ ] **Step 5: Run the production build**

Run `pnpm build`. Expected: the optimized Next.js build exits with code 0.

### Self-review

- The change has one product behavior, no new API surface, and no persistence migration.
- The existing 10/50 and 1/4 controls are reused; users can still choose the full suite.
- The notice describes an initial preset, so it remains truthful after users edit the values.
