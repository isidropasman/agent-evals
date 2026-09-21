import { describe, expect, it } from "vitest";
import { evaluateDeterministic, parseEvaluatorDefinition } from "@/engine/evaluators";

describe("deterministic evaluators", () => {
  it("passes when contains evaluator finds a case-insensitive value", () => {
    const result = evaluateDeterministic({ type: "contains", value: "refund" }, "Your REFUND is ready");
    expect(result).toEqual({ ok: true, value: { pass: true, failedCriteria: [], rationale: "contains matched" } });
  });

  it("fails with a stable criterion when regex does not match", () => {
    const result = evaluateDeterministic({ type: "regex", pattern: "^approved$" }, "pending");
    expect(result).toEqual({ ok: true, value: { pass: false, failedCriteria: ["regex did not match"], rationale: "regex did not match" } });
  });

  it("compares exact JSON after canonical serialization", () => {
    const result = evaluateDeterministic({ type: "exact_json", value: { total: 10, currency: "USD" } }, JSON.stringify({ currency: "USD", total: 10 }));
    expect(result).toEqual({ ok: true, value: { pass: true, failedCriteria: [], rationale: "exact JSON matched" } });
  });

  it("rejects unsafe or malformed evaluator definitions", () => {
    expect(parseEvaluatorDefinition({ type: "regex", pattern: "[" })).toEqual({ ok: false, error: "invalid_evaluator" });
    expect(parseEvaluatorDefinition({ type: "unknown" })).toEqual({ ok: false, error: "invalid_evaluator" });
  });
});
