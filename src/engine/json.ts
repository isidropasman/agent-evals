import type { EngineResult } from "./types";

/**
 * Extract a JSON value from an LLM response that may wrap it in prose or
 * markdown fences. With structured outputs the text is already pure JSON;
 * this is the safety net for mock mode and fence-wrapped replies.
 */
export function extractJson<T>(text: string): EngineResult<T> {
  const candidates = [text.trim()];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as T };
    } catch {
      // try next candidate
    }
  }
  return {
    ok: false,
    error: {
      kind: "parse_error",
      message: `Could not parse JSON from response: ${text.slice(0, 200)}`,
    },
  };
}
