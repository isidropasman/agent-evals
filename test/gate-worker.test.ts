import { describe, expect, it } from "vitest";
import { exhaustedGateCounts } from "@/server/gate-worker";

describe("gate worker failure finalization", () => {
  it("marks a gate with no persisted results as one terminal error", () => {
    expect(exhaustedGateCounts({ total: 0, passed: 0, failed: 0, errors: 0 })).toEqual({
      total: 1,
      passed: 0,
      failed: 0,
      errors: 1,
    });
  });

  it("preserves completed case counts and accounts for unfinished work", () => {
    expect(exhaustedGateCounts({ total: 5, passed: 2, failed: 1, errors: 0 })).toEqual({
      total: 5,
      passed: 2,
      failed: 1,
      errors: 2,
    });
  });
});
