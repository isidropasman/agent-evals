# Agent Evals Platform Design

## Goal

Turn Gauntlet from a local endpoint runner into a workspace-based evaluation control plane that can receive real agent executions, run reproducible suites, and expose the same evidence through a dashboard, API, CLI, and MCP.

## Product boundary

Gauntlet has two evaluation lanes:

1. **Black-box lane:** Gauntlet drives a registered endpoint with generated scenarios. This remains the zero-instrumentation path.
2. **Observed lane:** an agent or adapter sends execution traces to Gauntlet. This lane evaluates the actual trajectory, tool calls, and declared assertions without pretending that a mocked tool result proves a real side effect.

MCP is the control surface for agents and developer tools. It exposes operations such as registering an agent, starting a suite, reading a run, and retrieving a failure. It is not the trace transport. Traces use a typed ingest API so SDKs, CI, and non-MCP runtimes can emit events without requiring an LLM client.

## First vertical slice

The first shipped slice must work locally without a hosted dependency:

- one default workspace is created on first use;
- workspace API keys authenticate machine-to-machine calls;
- agents can be registered through an API endpoint or MCP;
- trace envelopes can be ingested and are visible from the dashboard;
- MCP exposes `list_agents`, `register_agent`, `run_suite`, `get_run`, `get_trace`;
- existing suite execution keeps using `runEval` and `runConfigForPreset`;
- each record carries workspace ownership and source metadata;
- tests cover auth, tenant isolation, idempotent trace ingest, MCP JSON-RPC, and dashboard DTOs.

## Data contracts

### Workspace

```ts
interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}
```

### Agent registration

```ts
interface AgentRegistration {
  id?: string;
  name: string;
  clientName?: string;
  endpointUrl?: string;
  protocol?: "openai" | "coval";
  systemPrompt?: string;
  agentFamily?: "anthropic" | "openai" | "unknown";
  mode?: "auto" | "conversational" | "task";
  source: "manual" | "sdk" | "mcp" | "ci";
  externalId?: string;
}
```

Endpoint and system prompt are optional for observed-only agents. A dashboard card must show whether the agent is runnable black-box, observed-only, or both.

### Trace envelope

```ts
interface TraceEnvelope {
  traceId: string;
  eventId: string;
  agentId: string;
  deployment?: string;
  version?: string;
  parentId?: string;
  kind: "run" | "turn" | "tool_call" | "tool_result" | "assertion";
  input?: unknown;
  output?: unknown;
  toolName?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  latencyMs?: number;
  status?: "ok" | "error";
  assertion?: {
    name: string;
    passed: boolean;
    detail?: string;
  };
  occurredAt: number;
  metadata?: Record<string, string>;
}
```

The ingest endpoint is idempotent on `(workspaceId, eventId)`. Payload retention is bounded and secrets are never accepted as a first-class field. The default UI shows metadata and summaries, not raw payloads.

## MCP surface

The HTTP MCP endpoint uses the workspace credential and returns structured tool results:

- `list_agents({})` returns public agent identity, source, capability, and latest signal.
- `register_agent({ registration })` creates or updates an agent by `externalId`.
- `run_suite({ agentId, suite, scenarioCount, k })` starts the existing run engine.
- `get_run({ runId })` returns status, progress, report summary, and failure counts.
- `get_trace({ agentId, traceId })` returns a redacted trace summary and assertion results.

The MCP handler owns protocol validation and maps tool errors to structured results. It never exposes auth tokens, system prompts, or raw secrets.

## Dashboard changes

The dashboard becomes a workspace signal view:

- source badge: `black-box`, `observed`, or `hybrid`;
- latest trace signal beside latest suite score;
- agent version/deployment and last seen timestamp;
- run actions disabled with an explanation for observed-only agents;
- trace detail link next to run detail;
- workspace/API key setup entry point for local integrations.

## Security and tenancy

- Every persisted agent, run, and trace has `workspace_id`.
- API keys are shown once, stored hashed, and accepted via `Authorization: Bearer` or `x-gauntlet-key`.
- Public DTOs never include endpoint credentials, tokens, system prompts, or raw trace payloads.
- Unknown workspace keys fail closed.
- SSRF validation remains mandatory for black-box endpoint execution.
- The local default workspace is a development convenience, not a claim of hosted multi-user auth. A hosted deployment can replace the workspace resolver with OAuth/Clerk without changing the evaluation contracts.

## Proof of superiority

Gauntlet does not claim universal superiority over a one-off Claude prompt. It earns the claim on measurable dimensions:

- repeatability: pinned suite and scenario IDs, `k` repetitions, and flake rate;
- coverage: explicit suite mix and category accounting;
- evaluator quality: mutation recall, healthy-control false positives, and human agreement;
- evidence: persisted traces, tool events, assertions, and versioned baselines;
- regression safety: same-suite deltas and CI gates;
- evaluator failure isolation: endpoint, agent, judge, and infrastructure failures remain distinct.

The benchmark must publish these metrics, including failures. A prompt-only workflow remains useful for exploratory debugging; Gauntlet is for evidence that survives a deploy, a refresh, and a team handoff.

## Out of scope for the first slice

- hosted billing and organization management;
- provider-specific auto-instrumentation for every agent framework;
- arbitrary database side-effect verification without an assertion adapter;
- replacing the existing evaluator or introducing a second scoring implementation.
