import type { LlmProvider } from "./provider";
import { extractJson } from "./json";
import type { EngineResult, PromptFix, ScenarioResult, Turn } from "./types";

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    problem: { type: "string" },
    diff: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["problem", "diff", "rationale"],
} as const;

function condenseTranscript(transcript: Turn[], maxChars = 1500): string {
  const full = transcript
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
  return full.length > maxChars ? full.slice(0, maxChars) + "\n[...truncated]" : full;
}

/**
 * Single-shot fix diffs (v0 of the improvement loop — GEPA-style evolutionary
 * search is v2). Groups failing scenarios by category and asks the model for a
 * targeted system-prompt diff addressing the observed failures.
 */
export async function proposeFixes(
  provider: LlmProvider,
  fixerModel: string,
  agentSystemPrompt: string,
  scenarioResults: ScenarioResult[],
): Promise<EngineResult<PromptFix[]>> {
  const failing = scenarioResults.filter((r) => !r.passK);
  if (failing.length === 0) return { ok: true, value: [] };

  // Group failures by category so each fix targets a coherent class of problem.
  const byCategory = new Map<string, ScenarioResult[]>();
  for (const r of failing) {
    const list = byCategory.get(r.scenario.category) ?? [];
    list.push(r);
    byCategory.set(r.scenario.category, list);
  }

  const fixes: PromptFix[] = [];
  for (const [category, results] of byCategory) {
    const examples = results
      .slice(0, 4)
      .map((r) => {
        const failed = r.attempts.find((a) => !a.verdict.pass) ?? r.attempts[0];
        return `Scenario "${r.scenario.title}" (${r.scenario.id})
Objective: ${r.scenario.objective}
Failed criteria: ${failed?.verdict.failedCriteria.join("; ") || "n/a"}
Judge rationale: ${failed?.verdict.rationale || "n/a"}
Transcript excerpt:
${failed ? condenseTranscript(failed.transcript) : "(none)"}`;
      })
      .join("\n\n---\n\n");

    const system = `You improve AI agent system prompts. Given failing test conversations, you propose a targeted edit to the agent's system prompt that would fix the observed failures without breaking other behavior. You output only valid JSON. Prefer minimal, additive changes.`;

    const userPrompt = `The agent under test has this system prompt:

<agent_system_prompt>
${agentSystemPrompt}
</agent_system_prompt>

These "${category}" scenarios failed:

${examples}

Propose ONE targeted fix. Output JSON:
{"problem": "what's wrong, one sentence", "diff": "a unified-diff-style or before/after snippet showing the exact system-prompt change", "rationale": "why this fixes the failures without regressions"}`;

    const result = await provider.complete({
      model: fixerModel,
      system,
      maxTokens: 6000,
      messages: [{ role: "user", content: userPrompt }],
      jsonSchema: FIX_SCHEMA as unknown as Record<string, unknown>,
    });
    if (!result.ok) return result;

    const parsed = extractJson<Omit<PromptFix, "scenarioIds">>(result.value);
    if (!parsed.ok) return parsed;

    fixes.push({
      ...parsed.value,
      scenarioIds: results.map((r) => r.scenario.id),
    });
  }

  return { ok: true, value: fixes };
}
