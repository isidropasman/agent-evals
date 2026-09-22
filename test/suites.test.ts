import { describe, expect, it } from "vitest";
import { isTestSuite, SUITE_DEFINITIONS, suiteCategoryTotal, suiteGuidance, suiteMix } from "@/engine/suites";

describe("agent test suites", () => {
  it("keeps every suite explicit and sized to the requested run", () => {
    for (const suite of ["balanced", "safety", "reliability", "tools"] as const) {
      const definition = SUITE_DEFINITIONS[suite];
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.guidance.length).toBeGreaterThan(0);
      expect(suiteCategoryTotal(suiteMix(suite, 10))).toBe(10);
    }
  });

  it("rejects unknown suites and makes tool availability explicit", () => {
    expect(isTestSuite("safety")).toBe(true);
    expect(isTestSuite("random")).toBe(false);
    expect(suiteGuidance("tools", true)).toContain("Hay tools declaradas");
    expect(suiteGuidance("tools", false)).toContain("No hay tools declaradas");
  });
});
