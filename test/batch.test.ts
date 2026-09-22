import { describe, expect, it } from "vitest";
import { startBoundedBatch } from "@/server/batch";

describe("startBoundedBatch", () => {
  it("never exceeds its concurrency limit and launches every task", async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    await startBoundedBatch([1, 2, 3, 4, 5], 2, async (task) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed.push(task);
      active -= 1;
    });

    expect(peak).toBe(2);
    expect(completed.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5]);
    expect(active).toBe(0);
  });

  it("rejects an invalid concurrency limit", async () => {
    await expect(startBoundedBatch([1], 0, async () => undefined)).rejects.toThrow(
      "maxConcurrent",
    );
  });
});
