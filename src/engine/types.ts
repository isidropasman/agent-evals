export type ScenarioCategory = "happy_path" | "edge_case" | "adversarial";

/** Conversational agents (chat/voice/support) are tested by simulating a user
 * across turns. Task agents (invoice extraction, classification, transforms)
 * are tested by feeding one input document and judging the single output. */
export type EvalMode = "conversational" | "task";

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  persona: string;
  objective: string;
  successCriteria: string;
  maxTurns: number;
  /** Task mode only: the input document/payload sent to the agent single-shot. */
  input?: string;
}

export interface RubricItem {
  id: string;
  criterion: string;
}

export interface Rubric {
  items: RubricItem[];
}

export interface Turn {
  /** "tool" covers both a tool call request and its result — folded into one
   * role because both are "not the user, not really the assistant's own
   * words"; the direction (→ call / ← result) is encoded in `content`. */
  role: "user" | "assistant" | "tool";
  content: string;
}

/** A tool the agent under test can call, declared by the user (OpenAI
 * tools[] shape) so Gauntlet can mock plausible results without owning the
 * agent's real implementation. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool's arguments — passed through to the mocker as
   * context, not validated. */
  parameters?: Record<string, unknown>;
}

export interface Verdict {
  pass: boolean;
  failedCriteria: string[];
  rationale: string;
}

export interface ConversationResult {
  scenarioId: string;
  attempt: number;
  transcript: Turn[];
  verdict: Verdict;
  error?: string;
  /** The conversation happened but could not be judged (judge outage, bad
   * JSON). Distinct from a failure: an agent must never be marked down for
   * our own inability to evaluate it, so these are excluded from scoring and
   * reported separately. A connector failure is NOT this — an agent that
   * doesn't respond really did fail. */
  unevaluated?: boolean;
}

export interface ScenarioResult {
  scenario: Scenario;
  attempts: ConversationResult[];
  passK: boolean;
  /** No attempt of this scenario could be judged — excluded from the score. */
  unevaluated: boolean;
}

export interface PromptFix {
  scenarioIds: string[];
  problem: string;
  diff: string;
  rationale: string;
}

export interface CategoryScore {
  category: ScenarioCategory;
  total: number;
  passed: number;
  rate: number;
}

export interface RunReport {
  score: number;
  certified: boolean;
  categories: CategoryScore[];
  scenarioResults: ScenarioResult[];
  fixes: PromptFix[];
  judgeModel: string;
  judgeFamilyDisclaimer: string | null;
  totals: {
    scenarios: number;
    passed: number;
    conversations: number;
    /** Conversations that ran but could not be judged. A run with a material
     * share of these cannot be certified — the score is computed over fewer
     * conversations than it appears to be. */
    unevaluated: number;
  };
  /** What Gauntlet understood about the agent before designing the test plan. */
  profile: AgentProfile;
}

/**
 * What Gauntlet understood about the agent before designing any tests. Instead
 * of the user picking a mode and Gauntlet running one of two fixed templates,
 * the profiler reads the system prompt and derives the agent's actual shape —
 * its input/output surface, what it's supposed to do, what it must refuse, and
 * the failure modes specific to THIS agent (not a generic checklist). Scenario
 * and task generation then target those specifics.
 */
export interface AgentProfile {
  /** One paragraph: what this agent is and does, in plain language. */
  summary: string;
  /** Inferred testing mode. */
  mode: EvalMode;
  modeConfidence: "high" | "medium" | "low";
  /** Why the profiler picked that mode — auditable, not a black box. */
  modeRationale: string;
  /** The domain/vertical, e.g. "invoice processing", "SaaS billing support". */
  domain: string;
  /** What the agent is supposed to be able to do. */
  capabilities: string[];
  /** What the agent must refuse or stay out of — scope boundaries. */
  boundaries: string[];
  /** Agent-SPECIFIC ways this could break in production. */
  failureModes: string[];
  /** Domain-specific adversarial angles worth targeting. */
  riskAreas: string[];
  /** Tool/function names the profiler believes this agent has access to,
   * inferred from the prompt and/or the user-declared tool list. Empty if
   * the agent doesn't appear to use tools. */
  toolsDetected: string[];
}

export interface RunConfig {
  scenarioCount: number;
  mix: Record<ScenarioCategory, number>;
  k: number;
  weights: Record<ScenarioCategory, number>;
  maxTurns: number;
  concurrency: number;
  /** Safety cap on tool-call rounds within a single turn — an agent that
   * keeps calling tools without ever answering is itself a failure mode
   * (infinite tool loop), not a bug in Gauntlet. */
  maxToolCallsPerTurn: number;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  scenarioCount: 50,
  mix: { happy_path: 20, edge_case: 15, adversarial: 15 },
  k: 4,
  weights: { happy_path: 0.4, edge_case: 0.3, adversarial: 0.3 },
  maxTurns: 8,
  concurrency: 10,
  maxToolCallsPerTurn: 6,
};

export type EngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError };

export interface EngineError {
  kind:
    | "connector_unreachable"
    | "connector_bad_response"
    | "provider_error"
    | "provider_rate_limited"
    | "parse_error"
    | "config_error"
    | "tool_loop_exceeded";
  message: string;
}

export interface RunProgress {
  phase: "generating" | "simulating" | "judging" | "fixing" | "done" | "error";
  completedConversations: number;
  totalConversations: number;
  message: string;
}
