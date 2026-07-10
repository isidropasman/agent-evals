export type ScenarioCategory = "happy_path" | "edge_case" | "adversarial";

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  persona: string;
  objective: string;
  successCriteria: string;
  maxTurns: number;
}

export interface RubricItem {
  id: string;
  criterion: string;
}

export interface Rubric {
  items: RubricItem[];
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
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
}

export interface ScenarioResult {
  scenario: Scenario;
  attempts: ConversationResult[];
  passK: boolean;
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
  totals: { scenarios: number; passed: number; conversations: number };
}

export interface RunConfig {
  scenarioCount: number;
  mix: Record<ScenarioCategory, number>;
  k: number;
  weights: Record<ScenarioCategory, number>;
  maxTurns: number;
  concurrency: number;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  scenarioCount: 50,
  mix: { happy_path: 20, edge_case: 15, adversarial: 15 },
  k: 4,
  weights: { happy_path: 0.4, edge_case: 0.3, adversarial: 0.3 },
  maxTurns: 8,
  concurrency: 10,
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
    | "config_error";
  message: string;
}

export interface RunProgress {
  phase: "generating" | "simulating" | "judging" | "fixing" | "done" | "error";
  completedConversations: number;
  totalConversations: number;
  message: string;
}
