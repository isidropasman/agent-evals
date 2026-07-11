import { probeAgent, type AgentConnection } from "./connector";
import { judgeConversation } from "./judge";
import { proposeFixes } from "./fixer";
import { AnthropicProvider, MODELS, type LlmProvider } from "./provider";
import { profileAgent } from "./profiler";
import { generateRubric, generateScenarios } from "./scenarios";
import { generateTaskCases, executeTask } from "./tasks";
import { simulateConversation } from "./simulator";
import {
  DEFAULT_RUN_CONFIG,
  type AgentProfile,
  type CategoryScore,
  type ConversationResult,
  type EngineResult,
  type EvalMode,
  type RunConfig,
  type RunProgress,
  type RunReport,
  type Scenario,
  type ScenarioCategory,
  type ScenarioResult,
} from "./types";

export interface RunInput {
  connection: AgentConnection;
  agentSystemPrompt: string;
  config?: Partial<RunConfig>;
  /** Detected family of the agent under test, to pick a cross-family judge. */
  agentFamily?: "anthropic" | "openai" | "unknown";
  /** Force a mode instead of letting the profiler infer it from the system
   * prompt. Omit this to have Gauntlet understand the agent and decide. */
  mode?: EvalMode;
  onProgress?: (p: RunProgress) => void;
  /** Aborts the run at the next job boundary. */
  signal?: AbortSignal;
}

export interface Providers {
  profiler: LlmProvider;
  scenarioGen: LlmProvider;
  userSim: LlmProvider;
  judge: LlmProvider;
  fixer: LlmProvider;
  judgeModel: string;
}

/** Used when the profiler call itself fails — profiling is a quality
 * enhancement, not a hard dependency. The run still proceeds with the
 * caller's requested mode (or the historical conversational default) and
 * generic category guidance instead of agent-specific findings. */
function fallbackProfile(mode: EvalMode, reason: string): AgentProfile {
  return {
    summary: "Perfil no disponible — el análisis del agente falló.",
    mode,
    modeConfidence: "low",
    modeRationale: `No se pudo perfilar el agente (${reason}). Se usó el modo solicitado.`,
    domain: "desconocido",
    capabilities: [],
    boundaries: [],
    failureModes: [],
    riskAreas: [],
  };
}

export class RunAbortedError extends Error {
  constructor() {
    super("run aborted");
    this.name = "RunAbortedError";
  }
}

/** Promise pool with a fixed concurrency ceiling. Checks `signal` between jobs
 * so a cancel stops the run at the next boundary (in-flight jobs finish). */
async function pool<T>(
  items: (() => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new RunAbortedError();
      const index = cursor++;
      const task = items[index];
      if (task) results[index] = await task();
    }
  });
  await Promise.all(workers);
  return results;
}

function pickJudge(agentFamily: "anthropic" | "openai" | "unknown"): {
  model: string;
  disclaimer: string | null;
} {
  // Judge must differ in family from the agent under test to avoid
  // self-preference bias. Only Anthropic judging is wired here; when the agent
  // is Anthropic-based we still use an Anthropic judge and disclose it.
  if (agentFamily === "anthropic") {
    return {
      model: MODELS.judge,
      disclaimer:
        "El agente y el juez pertenecen a la misma familia de modelos (Anthropic). Configurar un juez OpenAI elimina el riesgo de self-preference bias.",
    };
  }
  return { model: MODELS.judge, disclaimer: null };
}

export function defaultProviders(apiKey?: string): Providers {
  const anthropic = new AnthropicProvider(apiKey);
  return {
    profiler: anthropic,
    scenarioGen: anthropic,
    userSim: anthropic,
    judge: anthropic,
    fixer: anthropic,
    judgeModel: MODELS.judge,
  };
}

export async function runEval(
  input: RunInput,
  providers: Providers,
): Promise<EngineResult<RunReport>> {
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, ...input.config };
  const emit = input.onProgress ?? (() => {});
  const signal = input.signal;
  const totalConversations =
    (config.mix.happy_path + config.mix.edge_case + config.mix.adversarial) *
    config.k;
  let completed = 0;

  // Preflight: fail fast on a dead endpoint / bad auth instead of burning a
  // full run's worth of LLM calls against an unreachable agent.
  emit({
    phase: "generating",
    completedConversations: 0,
    totalConversations,
    message: "Probando conexión con el agente",
  });
  const probe = await probeAgent(input.connection);
  if (!probe.ok) return probe;

  // Understand the agent before designing any tests: what it does, its
  // input/output shape, what it must refuse, and ITS specific failure modes —
  // instead of the caller picking one of two fixed templates. If profiling
  // fails, degrade to the caller's requested mode (or the historical
  // conversational default) with generic category guidance; profiling is a
  // quality enhancement, not a hard dependency for the run to proceed.
  emit({
    phase: "generating",
    completedConversations: 0,
    totalConversations,
    message: "Entendiendo qué hace el agente",
  });
  const profileResult = await profileAgent(
    providers.profiler,
    MODELS.profiler,
    input.agentSystemPrompt,
  );
  const profile: AgentProfile = profileResult.ok
    ? profileResult.value
    : fallbackProfile(input.mode ?? "conversational", profileResult.error.message);
  // input.mode is an explicit override; omitting it lets the profiler decide.
  const mode: EvalMode = input.mode ?? profile.mode;

  emit({
    phase: "generating",
    completedConversations: 0,
    totalConversations,
    message:
      mode === "task"
        ? "Generando documentos de prueba y rúbrica"
        : "Generando escenarios y rúbrica",
  });

  const [scenariosResult, rubricResult] = await Promise.all([
    mode === "task"
      ? generateTaskCases(
          providers.scenarioGen,
          MODELS.scenarioGen,
          input.agentSystemPrompt,
          config,
          profile,
        )
      : generateScenarios(
          providers.scenarioGen,
          MODELS.scenarioGen,
          input.agentSystemPrompt,
          config,
          profile,
        ),
    generateRubric(providers.judge, MODELS.judge, input.agentSystemPrompt, profile),
  ]);
  if (!scenariosResult.ok) return scenariosResult;
  if (!rubricResult.ok) return rubricResult;

  const scenarios = scenariosResult.value;
  const rubric = rubricResult.value;
  const judge = pickJudge(input.agentFamily ?? "unknown");

  // Build one task per (scenario × attempt). Each task simulates + judges.
  interface Job {
    scenario: Scenario;
    attempt: number;
  }
  const jobs: Job[] = [];
  for (const scenario of scenarios) {
    for (let attempt = 0; attempt < config.k; attempt++) {
      jobs.push({ scenario, attempt });
    }
  }

  emit({
    phase: "simulating",
    completedConversations: 0,
    totalConversations,
    message:
      mode === "task"
        ? `Procesando ${scenarios.length} documentos × k=${config.k}`
        : `Simulando ${scenarios.length} escenarios × k=${config.k}`,
  });

  const conversationResults = await pool(
    jobs.map((job) => async (): Promise<ConversationResult> => {
      const sessionId = `${job.scenario.id}-a${job.attempt}`;
      const sim =
        mode === "task"
          ? await executeTask(input.connection, job.scenario, sessionId)
          : await simulateConversation(
              providers.userSim,
              MODELS.userSim,
              input.connection,
              job.scenario,
              sessionId,
            );
      if (!sim.ok) {
        completed++;
        emit({
          phase: "simulating",
          completedConversations: completed,
          totalConversations,
          message: sim.error.message,
        });
        return {
          scenarioId: job.scenario.id,
          attempt: job.attempt,
          transcript: [],
          verdict: {
            pass: false,
            failedCriteria: ["conversation could not complete"],
            rationale: sim.error.message,
          },
          error: sim.error.message,
        };
      }

      const verdict = await judgeConversation(
        providers.judge,
        judge.model,
        job.scenario,
        rubric,
        sim.value,
      );
      completed++;
      emit({
        phase: "judging",
        completedConversations: completed,
        totalConversations,
        message: `${job.scenario.title} (intento ${job.attempt + 1})`,
      });

      if (!verdict.ok) {
        return {
          scenarioId: job.scenario.id,
          attempt: job.attempt,
          transcript: sim.value,
          verdict: {
            pass: false,
            failedCriteria: ["judge failed"],
            rationale: verdict.error.message,
          },
          error: verdict.error.message,
        };
      }
      return {
        scenarioId: job.scenario.id,
        attempt: job.attempt,
        transcript: sim.value,
        verdict: verdict.value,
      };
    }),
    config.concurrency,
    signal,
  );

  // Group by scenario and apply pass^k: a scenario passes only if ALL k attempts pass.
  const byScenario = new Map<string, ConversationResult[]>();
  for (const cr of conversationResults) {
    const list = byScenario.get(cr.scenarioId) ?? [];
    list.push(cr);
    byScenario.set(cr.scenarioId, list);
  }

  const scenarioResults: ScenarioResult[] = scenarios.map((scenario) => {
    const attempts = (byScenario.get(scenario.id) ?? []).sort(
      (a, b) => a.attempt - b.attempt,
    );
    const passK = attempts.length > 0 && attempts.every((a) => a.verdict.pass);
    return { scenario, attempts, passK };
  });

  const categories = computeCategoryScores(scenarioResults);
  const score = computeWeightedScore(categories, config.weights);

  emit({
    phase: "fixing",
    completedConversations: totalConversations,
    totalConversations,
    message: "Generando fixes sugeridos",
  });

  const fixesResult = await proposeFixes(
    providers.fixer,
    MODELS.fixer,
    input.agentSystemPrompt,
    scenarioResults,
  );
  const fixes = fixesResult.ok ? fixesResult.value : [];

  const passedScenarios = scenarioResults.filter((r) => r.passK).length;
  const report: RunReport = {
    score,
    certified: score >= 0.9 && categories.every((c) => c.rate >= 0.8),
    categories,
    scenarioResults,
    fixes,
    judgeModel: judge.model,
    judgeFamilyDisclaimer: judge.disclaimer,
    totals: {
      scenarios: scenarios.length,
      passed: passedScenarios,
      conversations: totalConversations,
    },
    profile,
  };

  emit({
    phase: "done",
    completedConversations: totalConversations,
    totalConversations,
    message: "Listo",
  });

  return { ok: true, value: report };
}

function computeCategoryScores(results: ScenarioResult[]): CategoryScore[] {
  const categories: ScenarioCategory[] = ["happy_path", "edge_case", "adversarial"];
  return categories.map((category) => {
    const inCat = results.filter((r) => r.scenario.category === category);
    const passed = inCat.filter((r) => r.passK).length;
    return {
      category,
      total: inCat.length,
      passed,
      rate: inCat.length > 0 ? passed / inCat.length : 0,
    };
  });
}

function computeWeightedScore(
  categories: CategoryScore[],
  weights: Record<ScenarioCategory, number>,
): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const cat of categories) {
    if (cat.total === 0) continue;
    const w = weights[cat.category];
    weightedSum += cat.rate * w;
    weightTotal += w;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}
