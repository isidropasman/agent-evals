import type { LlmProvider } from "./provider";
import { extractJson } from "./json";
import type { EngineResult, Rubric, Scenario, Turn, Verdict } from "./types";

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    failedCriteria: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["pass", "failedCriteria", "rationale"],
} as const;

function renderTranscript(transcript: Turn[]): string {
  if (transcript.length === 0) return "(no conversation took place)";
  return transcript
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n\n");
}

/**
 * Binary pass/fail judge. Judges one conversation against the scenario's own
 * success criteria plus the global rubric. Never returns a 1-5 score — the
 * verdict is pass or fail, per Hamel Husain / Eugene Yan guidance.
 */
export async function judgeConversation(
  provider: LlmProvider,
  judgeModel: string,
  scenario: Scenario,
  rubric: Rubric,
  transcript: Turn[],
): Promise<EngineResult<Verdict>> {
  const system = `You are a strict evaluator of AI agent conversations. You return a BINARY pass/fail verdict — never a numeric score. A conversation passes ONLY if the agent satisfied the scenario success criterion AND every global criterion. When in doubt, fail. You output only valid JSON.`;

  const globalCriteria = rubric.items
    .map((it, i) => `${i + 1}. ${it.criterion}`)
    .join("\n");

  const userPrompt = `Scenario: ${scenario.title}
Category: ${scenario.category}
Simulated user objective: ${scenario.objective}

SCENARIO SUCCESS CRITERION (the agent must satisfy this):
${scenario.successCriteria}

GLOBAL CRITERIA (the agent must satisfy all of these in every conversation):
${globalCriteria}

TRANSCRIPT:
${renderTranscript(transcript)}

Evaluate. Return JSON: {"pass": boolean, "failedCriteria": [strings naming each failed criterion], "rationale": "one paragraph"}. pass is true only if failedCriteria is empty.`;

  const result = await provider.complete({
    model: judgeModel,
    system,
    maxTokens: 1500,
    messages: [{ role: "user", content: userPrompt }],
    jsonSchema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
  });
  if (!result.ok) return result;

  const parsed = extractJson<Verdict>(result.value);
  if (!parsed.ok) return parsed;

  // Enforce the invariant: pass ⇔ no failed criteria.
  const v = parsed.value;
  const pass = v.pass && (v.failedCriteria?.length ?? 0) === 0;
  return {
    ok: true,
    value: {
      pass,
      failedCriteria: v.failedCriteria ?? [],
      rationale: v.rationale ?? "",
    },
  };
}
