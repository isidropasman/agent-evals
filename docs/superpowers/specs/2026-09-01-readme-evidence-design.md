# Gauntlet README and evidence redesign

## Objective

Make the repository explain Gauntlet as a serious black-box evaluation harness for AI agents within the first few seconds, then let a technical reader audit the product, reproduce the benchmark, install it, and understand its limits without relying on hype.

The deliverable is a documentation and evidence layer. It must make the current product easier to trust without claiming capabilities that are not implemented or measured.

## Scope

This design follows the approved “README + verifiable evidence” option.

### Included

- A full `README.md` rewrite in English.
- A product thesis and value proposition grounded in the current engine.
- A compact data strip with benchmark context next to every headline metric.
- Four Mermaid diagrams that explain different relationships:
  - product loop from endpoint to fix or CI gate;
  - runtime architecture and trust boundaries;
  - tool-call sequence with mocked and adversarial tool results;
  - measurement invariants from verdict to certificate.
- A technical decisions section linked to the relevant implementation files.
- A first-run path using the bundled demo agent and a real endpoint path using API keys.
- A checked-in example configuration and a redacted example report, if the existing CLI/report contracts support them without adding product behavior.
- Screenshots of the current web UI for onboarding, run results, and benchmark pages, stored under `docs/assets/`.
- A benchmark section with methodology, raw-result links, exact run parameters, and explicit limitations.
- A repository map and verification commands.

### Excluded

- New evaluator capabilities hidden inside the documentation change.
- Claims of production readiness, universal domain accuracy, or guaranteed security.
- Customer data, real API keys, or screenshots containing sensitive values.
- A docs site, custom documentation generator, or a second application shell.
- A new product metric that is not already emitted by the benchmark or engine.

## Reader journeys

The README should support three reading depths without making any reader hunt for the next action.

### 20 seconds: understand the product

The hero must answer:

1. What is it? A black-box test harness for AI agents.
2. What goes in? An HTTP endpoint, a system prompt, and optional tool definitions.
3. What comes out? Transcripts, binary verdicts, scores, prompt fixes, and a CI gate.
4. Why trust it? The benchmark found `7/7` planted defects with `98%` judge recall in the published run.

The metric strip must state that those numbers come from controlled fixtures, `12` scenarios per fixture, and `k=2`. Metrics without their denominator or methodology are not acceptable.

### 2 minutes: see how it works

The product loop and runtime architecture diagrams should show the evaluator as a boundary around providers, the agent endpoint, tools, and local persistence. A short explanation should connect every stage to the artifact it produces.

The “60-second start” should appear before the long configuration reference. It should offer the demo agent first so a reader can see a complete run without an external endpoint.

### 10 minutes: audit the engineering

The technical reader should be able to jump from a design decision to its implementation:

| Decision | Source of truth | Evidence to show |
| --- | --- | --- |
| Protocol and session normalization | `src/engine/connector.ts` | OpenAI-compatible and Coval request/response contracts; session ID propagation |
| Agent-aware scenario generation | `src/engine/profiler.ts`, `src/engine/scenarios.ts` | Profile fallback and round-robin attack-class assignment |
| Tool testing without production tools | `src/engine/tool-loop.ts` | Declared/undeclared tool handling, mocked result loop, six-round cap |
| Judge credibility and outage handling | `src/engine/runner.ts`, `src/engine/judge.ts` | Cross-family selection, one retry, `unevaluated`, certificate coverage threshold |
| Provider compatibility | `src/engine/provider.ts`, `src/engine/json.ts` | Retry/backoff and JSON-object fallback for OpenAI-compatible gateways |
| Endpoint safety | `src/engine/ssrf.ts`, `src/engine/connector.ts` | A/AAAA resolution, range classification, revalidation, manual redirects, response cap |
| Repeatability and CI | `src/cli/config.ts`, `src/cli/report.ts`, `bench/run.ts` | Config schema, exit codes, report path, benchmark flags |

Each row needs a sentence about the user-facing consequence. The README should not list implementation details as trivia; it should explain what failure mode each decision prevents.

## Information architecture

The final README should use this order:

1. Hero, one-sentence thesis, navigation links, badges.
2. Metric strip and benchmark context.
3. “Why Gauntlet” with four concrete product principles.
4. Product loop diagram.
5. “60-second start” with demo and real endpoint paths.
6. “How it evaluates” with runtime architecture diagram and phase descriptions.
7. Tool-call sequence diagram.
8. “The hard parts” decision table.
9. Measurement invariants diagram and `pass^k` explanation.
10. Endpoint contracts.
11. Reproducible benchmark and raw evidence.
12. Current fixtures and defect taxonomy.
13. Security and operational limits.
14. Development commands and repository map.
15. Status, known limitations, and license.

The ordering deliberately places installation before exhaustive configuration. A reader should be able to run the demo before reading every field in `gauntlet.config.json`.

## Visual system

Use GitHub-native Markdown and Mermaid. Avoid decorative diagrams that duplicate prose.

### Diagram 1: product loop

`endpoint → profile → targeted cases → simulated interactions → transcript → judge → gate → ship or prompt fix`

Purpose: communicate the product's closed loop and show that a failed run produces a repair path.

### Diagram 2: runtime architecture

Show these nodes and boundaries:

- user-provided endpoint;
- connector and SSRF policy;
- Anthropic generation/simulation/fixing provider;
- optional OpenAI-compatible judge;
- runner and scoring;
- local SQLite run store;
- report, certificate, and CI output.

Use dashed boundaries to show external systems and local persistence. The diagram should make clear that the evaluator does not own the agent's production tools.

### Diagram 3: tool-call sequence

Show the agent asking for a tool, Gauntlet generating a result, the result being fed back to the agent, and the final transcript going to the judge. Include the adversarial branch where a tool result contains text the agent must treat as data rather than as instructions.

### Diagram 4: measurement invariants

Show the difference between:

- a valid pass/fail verdict;
- an `unevaluated` conversation;
- a scenario passing only when all `k` attempts pass;
- a run that cannot receive a certificate when more than 5% of conversations are unjudged.

This is the most important diagram for avoiding misleading scores.

## Evidence artifacts

### Screenshots

Capture the running application against the bundled demo agent and use redacted, deterministic states:

- `docs/assets/onboarding.png`: endpoint setup and demo-agent entry point;
- `docs/assets/run-results.png`: score, transcripts, failed criteria, and fixes;
- `docs/assets/benchmark.png`: benchmark comparison and fixture results.

Screenshots must be generated from the current UI, contain no keys or private endpoints, and be updated whenever the referenced flow changes. If deterministic screenshots cannot be produced without external credentials, omit them and keep Mermaid as the visual layer. Never use a fabricated UI image.

### Example configuration

Add a minimal example only if it is validated by the current CLI parser. It must use `agentFamily: "unknown"`, `auth.type: "none"`, a local endpoint, and the same field names documented in the configuration table.

### Example report

Prefer a redacted report generated from the mock benchmark or a checked-in fixture over a hand-authored JSON blob. The README should link to it and explain the fields that matter: `score`, `categories`, `scenarioResults`, `unevaluated`, `judgeFamilyDisclaimer`, and `fixes`.

## Data and claim policy

Every public statement in the README must fit one of these categories:

| Label | Allowed source | Example |
| --- | --- | --- |
| Implemented | Current source and tests | “The connector caps agent responses at 256 KiB.” |
| Measured | Checked-in benchmark output | “The published run found 7/7 planted defects.” |
| Limitation | Current source, tests, or explicit missing coverage | “The DNS-rebinding window is not fully eliminated.” |

Do not use comparative words such as “best”, “only”, or “most accurate” unless a benchmark directly supports them. Do not round `12.5%` into a headline without explaining that `13%` is the adjudicated figure. Keep benchmark date, scenario count, `k`, judge family, and control methodology adjacent to the result.

## Installation design

The README should offer two paths.

### Demo endpoint

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000` and choose the bundled demo agent. The demo endpoint removes the need to connect your own agent, but a full LLM-backed evaluation still requires `ANTHROPIC_API_KEY`. Without credentials, the UI, connection flow, and mock benchmark can still be validated; do not describe that as a real agent evaluation.

### Real endpoint

```bash
export ANTHROPIC_API_KEY=...
pnpm dev
```

Then explain endpoint URL, protocol, auth, system prompt, tools, scenario count, `k`, and optional `OPENAI_API_KEY` in the same order as the wizard. Keep secrets in the environment for CI; explain the local UI storage tradeoff in the security section.

### CI path

```bash
pnpm gauntlet init
pnpm gauntlet run
```

Show the three exit codes and link the full configuration table. The README should state that the CLI may start a local agent, wait for a health path, write `gauntlet-report.json`, and stop the process.

## Validation plan

The documentation change is complete only when:

- `git diff --check` passes;
- `pnpm test` passes;
- `pnpm typecheck` passes;
- `pnpm build` passes;
- `pnpm bench --mock --out /tmp/gauntlet-bench-smoke.json` passes without LLM calls;
- every README code block uses a command or field present in the repository;
- all relative links resolve to tracked files or documented application routes;
- Mermaid fences are balanced and all four diagrams render in GitHub-compatible Markdown;
- screenshots, if included, are current, redacted, and captured from the actual app;
- the final diff contains only the intended README and evidence artifacts.

## Non-goals and follow-up candidates

If the README exposes gaps that require product work, record them separately rather than faking evidence. Valid follow-ups include:

- pinned-IP connections to close the DNS-rebinding window;
- versioned benchmark manifests and machine-readable metric provenance;
- a stable report fixture used by documentation tests;
- multi-instance run storage and cancellation semantics;
- real evaluation coverage for voice, image, audio, and multi-agent systems.

These are product or platform changes, not documentation claims.
