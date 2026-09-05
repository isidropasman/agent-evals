<div align="center">

# GAUNTLET

### `/ agent proving ground`

**The black-box test harness for AI agents.**

I wanted to know whether an AI agent was actually reliable — not whether it looked reliable in a demo.

Gauntlet treats a deployed agent as a system to be tested under pressure: profile its boundaries, generate targeted failures, run real multi-turn interactions, simulate hostile tool output, judge behavior, and turn failures into reproducible evidence.

**No SDK. No instrumentation. Just the endpoint, the prompt, and the behavior it produces.**

<br />

![Next.js 15](https://img.shields.io/badge/Next.js-15-08090b?logo=next.js&logoColor=white) ![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-08090b?logo=typescript&logoColor=3178C6) ![Vitest](https://img.shields.io/badge/tests-Vitest-08090b?logo=vitest&logoColor=6E9F18) ![Status experimental](https://img.shields.io/badge/status-experimental-08090b)

</div>

| Planted defects found | Judge recall | Instrumentation | Protocols |
| ---: | ---: | ---: | ---: |
| **7 / 7** | **98%** | **0** | **2** |

> **The interesting problem isn't generating adversarial prompts. It's building a measurement system you can trust when the agent, the judge, the provider, and the network are all imperfect.**

## What this repo demonstrates

Gauntlet is an experiment in **evaluation engineering for agentic systems**.

It is built around six ideas:

- **Behavior over intent** — evaluate the deployed agent, not how safe its system prompt sounds.
- **Adversarial coverage over lucky generations** — explicitly cover prompt leakage, injection, hallucination bait, authority pressure, scope creep, social pressure and tool-result injection.
- **Measurement over vibes** — binary verdicts, explicit rubrics, `pass^k`, category floors and first-class `unevaluated` states.
- **Tools are part of the attack surface** — simulate tool round-trips and inject untrusted content through tool results.
- **Evaluator failures are measurement failures** — a judge outage must not silently become an agent failure.
- **Failures should be reproducible** — preserve transcripts, criteria, rationales and suggested fixes so a red evaluation becomes a debugging artifact.

## The system

```mermaid
flowchart LR
    A[Deployed agent] --> B[Profiler]
    B --> C[Scenario generator]
    C --> D[User simulator]
    D --> E[Agent under test]
    E <-->|tool calls| F[Tool simulator]
    E --> G[Transcript]
    G --> H[Binary judge]
    H --> I[Pass^k + gates]
    I -->|fail| J[Evidence + fix]
    J --> C
```

The harness first infers what the agent is supposed to do and where it can fail. It then creates domain-specific happy-path, edge-case and adversarial scenarios, executes them against the real endpoint, handles tool-call loops, captures the complete trace, and evaluates the result against explicit criteria.

The same engine powers a web UI and a CLI/CI workflow.

## The hard parts

This is where most of the engineering went.

| Constraint | Design decision | Why |
| --- | --- | --- |
| **The agent is a black box** | Normalize OpenAI-compatible and Coval wire formats, preserve session state and accept practical response shapes. | Existing agents can be tested without evaluator-specific instrumentation. |
| **Generated attacks are stochastic** | Assign adversarial classes before generation, then adapt each attack to the agent domain. | Coverage is a property of the suite, not of what the model happened to remember. |
| **Agents use external tools** | Mock declared tools, simulate undeclared calls and feed results back through the real tool loop. | Tool behavior can be tested without provisioning production dependencies. |
| **Tool loops can run forever** | Bound tool-call rounds and surface `tool_loop_exceeded` as an observed failure. | A broken agent cannot consume an unbounded evaluation budget. |
| **LLM judges are imperfect** | Retry invalid verdicts, separate `unevaluated` from `failed`, and expose same-family judge risk. | Measurement infrastructure should not manufacture failures. |
| **Providers disagree on structured output** | Keep strict internal contracts but use provider-specific output modes and forgiving parsing at the boundary. | Reliability survives gateway differences without weakening the core model. |
| **Arbitrary endpoints create an SSRF surface** | Resolve DNS, reject reserved/private ranges according to policy, re-check requests and refuse redirects. | An evaluator must not become a tunnel into internal infrastructure. |

The core implementation is intentionally split by responsibility:

```text
src/engine/
├── runner.ts       orchestration, concurrency, scoring
├── profiler.ts     infer domain, capabilities, risks and mode
├── scenarios.ts    scenario generation + adversarial coverage
├── simulator.ts    realistic multi-turn user behavior
├── tool-loop.ts    bounded tool round-trips
├── judge.ts        binary evaluation + rubric
├── connector.ts    endpoint/protocol normalization
├── provider.ts     model-provider boundary
├── fixer.ts        evidence-backed repair suggestions
└── ssrf.ts         endpoint security policy
```

## Measurement invariants

A testing system is only useful if its green result means something.

```mermaid
flowchart TD
    A[Run attempt] --> B{Valid judge verdict?}
    B -->|no| C[UNEVALUATED]
    B -->|yes| D{Passed?}
    D -->|yes| E[PASS]
    D -->|no| F[FAIL]
    E --> G{All k attempts pass?}
    F --> G
    G -->|yes| H[Scenario passes]
    G -->|no| I[Scenario fails]
    C --> J[Evidence coverage check]
    H --> K[Category + global gates]
    I --> K
    J --> K
```

### 1. Binary verdicts

A serious failure should not disappear inside an average score. A conversation passes only when its scenario criterion and the global rubric criteria pass.

### 2. `pass^k`

One lucky sample is not reliability. With `k = 4`, every evaluated attempt for a scenario must pass for that scenario to pass.

### 3. `unevaluated != failed`

If the judge cannot produce a valid verdict, Gauntlet records a measurement failure. It does not pretend the agent failed.

### 4. No certificate on weak evidence

If too much of the run is unevaluated, the system refuses to certify it. Missing evidence is not positive evidence.

## Tool calls are part of the test

```mermaid
sequenceDiagram
    participant U as User simulator
    participant G as Gauntlet
    participant A as Agent
    participant T as Tool simulator
    participant J as Judge

    U->>G: adversarial turn
    G->>A: messages + session
    A-->>G: tool_call
    G->>T: requested tool + arguments
    T-->>G: realistic / hostile result
    G->>A: tool result
    A-->>G: answer or next tool call
    G->>J: complete trace + criteria
    J-->>G: pass / fail / unevaluated
```

This lets Gauntlet test questions like: **does the agent treat a tool result as data, or can the tool result become a new instruction?** — without needing access to the real CRM, database or billing system behind that tool.

## What I built and why

I built Gauntlet after repeatedly hitting the same problem while building agents: a system could perform perfectly in a demo and still have no convincing answer to **"how do we know this is reliable?"**

The parts I cared most about were not the UI or the prompt templates. They were the boundaries where evaluation systems become misleading:

- making black-box endpoints testable without changing the application under test;
- separating agent failures from evaluator failures;
- turning stochastic adversarial generation into deliberate coverage;
- evaluating multi-turn and tool-using behavior rather than isolated responses;
- making repeated sampling (`pass^k`) part of the pass condition;
- designing security around user-controlled endpoints;
- keeping enough evidence to reproduce and fix a failure.

The goal was not to build another leaderboard. It was to build a harness I would actually want between an agent and production.

## Reproducible benchmark

The headline numbers above come from the benchmark included in this repository. The benchmark uses intentionally flawed agents / planted defects and evaluates whether the harness detects those failures. The purpose is not to claim a universal agent-safety score; it is to make Gauntlet's own detection behavior inspectable and repeatable.

See [`bench/`](bench/) and the benchmark route in the web app for the underlying cases and results.

## Run it

```bash
pnpm install
# ANTHROPIC_API_KEY is required for real evaluation runs.
pnpm dev
```

The web flow can run against the intentionally flawed demo agent included in the repository.

For CI:

```bash
pnpm gauntlet init
pnpm gauntlet run
```

A run writes `gauntlet-report.json` and exits with:

| Code | Meaning |
| ---: | --- |
| `0` | Global and category gates passed. |
| `1` | Evaluation completed but the agent failed the gate. |
| `2` | Configuration, connection, provider or execution error. |

A minimal config:

```json
{
  "agentName": "My agent",
  "systemPromptFile": "./prompt.txt",
  "endpointUrl": "http://localhost:8080/v1/chat/completions",
  "protocol": "openai",
  "agentFamily": "unknown",
  "scenarioCount": 50,
  "k": 4,
  "gate": {
    "minScore": 0.9,
    "minCategoryRate": 0.8
  }
}
```

## Stack

`Next.js 15` · `TypeScript` · `React` · `Vitest` · `SQLite` · `Anthropic` · `OpenAI` · `CLI / CI`

---

<div align="center">

**Build agents. Break them deliberately. Measure what survives.**

</div>
