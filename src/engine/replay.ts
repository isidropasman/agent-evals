import { sendToAgent, type AgentConnection } from "./connector";
import { evaluateDeterministic, type EvaluatorDefinition } from "./evaluators";
import { judgeConversation } from "./judge";
import type { LlmProvider } from "./provider";
import type { EngineResult, Rubric, Scenario, Verdict } from "./types";

export interface RegressionReplayCase {
  id: string;
  name: string;
  inputText: string;
  assertionName: string;
  assertionDetail: string | null;
  expectedPass: boolean;
  evaluator?: EvaluatorDefinition | null;
}

export interface RegressionReplayInput {
  connection: AgentConnection;
  sessionId: string;
  testCase: RegressionReplayCase;
}

export interface RegressionReplayResult {
  passed: boolean;
  verdict: Verdict;
  latencyMs: number;
}

export async function runRegressionReplay(
  input: RegressionReplayInput,
  provider: LlmProvider,
  judgeModel: string,
): Promise<EngineResult<RegressionReplayResult>> {
  const startedAt = Date.now();
  const reply = await sendToAgent(
    input.connection,
    [{ role: "user", content: input.testCase.inputText }],
    input.sessionId,
  );
  const latencyMs = Date.now() - startedAt;
  if (!reply.ok) return reply;

  const scenario: Scenario = {
    id: `regression-${input.testCase.id}`,
    category: "edge_case",
    title: input.testCase.name,
    persona: "A real user replayed from an observed agent trace.",
    objective: input.testCase.inputText,
    successCriteria: input.testCase.assertionDetail ?? input.testCase.assertionName,
    maxTurns: 1,
  };
  const verdict = input.testCase.evaluator && input.testCase.evaluator.type !== "model"
    ? evaluateDeterministic(input.testCase.evaluator, reply.value)
    : await judgeConversation(
      provider,
      judgeModel,
      scenario,
      { items: [] } satisfies Rubric,
      [
        { role: "user", content: input.testCase.inputText },
        { role: "assistant", content: reply.value },
      ],
    );
  if (!verdict.ok) {
    if (typeof verdict.error === "string") {
      return { ok: false, error: { kind: "config_error", message: verdict.error } };
    }
    return verdict;
  }
  return {
    ok: true,
    value: {
      passed: verdict.value.pass === input.testCase.expectedPass,
      verdict: verdict.value,
      latencyMs,
    },
  };
}
