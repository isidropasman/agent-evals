import type { Verdict } from "./types";

export type EvaluatorDefinition =
  | { type: "model" }
  | { type: "contains"; value: string; caseSensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "exact_json"; value: unknown };

export type EvaluatorParseResult =
  | { ok: true; value: EvaluatorDefinition }
  | { ok: false; error: "invalid_evaluator" };

export type DeterministicEvaluationResult =
  | { ok: true; value: Verdict }
  | { ok: false; error: "invalid_evaluator"; message: string };

export function parseEvaluatorDefinition(raw: unknown): EvaluatorParseResult {
  if (!isRecord(raw) || typeof raw.type !== "string") return { ok: false, error: "invalid_evaluator" };
  if (raw.type === "model") return { ok: true, value: { type: "model" } };
  if (raw.type === "contains" && typeof raw.value === "string" && raw.value.length > 0) {
    return { ok: true, value: { type: "contains", value: raw.value, caseSensitive: raw.caseSensitive === true } };
  }
  if (raw.type === "regex" && typeof raw.pattern === "string" && raw.pattern.length > 0) {
    const flags = typeof raw.flags === "string" ? raw.flags : "";
    try {
      new RegExp(raw.pattern, flags);
    } catch {
      return { ok: false, error: "invalid_evaluator" };
    }
    return { ok: true, value: { type: "regex", pattern: raw.pattern, flags } };
  }
  if (raw.type === "exact_json" && "value" in raw) return { ok: true, value: { type: "exact_json", value: raw.value } };
  return { ok: false, error: "invalid_evaluator" };
}

export function evaluateDeterministic(definition: Exclude<EvaluatorDefinition, { type: "model" }>, output: string): DeterministicEvaluationResult {
  if (definition.type === "contains") {
    const haystack = definition.caseSensitive ? output : output.toLocaleLowerCase();
    const needle = definition.caseSensitive ? definition.value : definition.value.toLocaleLowerCase();
    return verdict(haystack.includes(needle), "contains matched", "contains did not match");
  }
  if (definition.type === "regex") {
    try {
      return verdict(new RegExp(definition.pattern, definition.flags).test(output), "regex matched", "regex did not match");
    } catch {
      return { ok: false, error: "invalid_evaluator", message: "regex evaluator is invalid" };
    }
  }
  try {
    const actual: unknown = JSON.parse(output);
    const pass = canonicalJson(actual) === canonicalJson(definition.value);
    return verdict(pass, "exact JSON matched", "exact JSON did not match");
  } catch {
    return verdict(false, "output is valid JSON", "output is not valid JSON");
  }
}

function verdict(pass: boolean, success: string, failure: string): { ok: true; value: Verdict } {
  const rationale = pass ? success : failure;
  return { ok: true, value: { pass, failedCriteria: pass ? [] : [failure], rationale } };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
