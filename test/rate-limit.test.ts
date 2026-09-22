import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/server/rate-limit";

describe("local rate limiter", () => {
  it("blocks after the configured budget and resets", async () => {
    const first = await checkRateLimit(`test-${Date.now()}-a`, 2, 1000, 10_000);
    const second = await checkRateLimit(`test-${Date.now()}-b`, 2, 1000, 10_000);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    const key = `test-${Date.now()}`;
    expect((await checkRateLimit(key, 1, 1000, 10_000)).allowed).toBe(true);
    expect((await checkRateLimit(key, 1, 1000, 10_000)).allowed).toBe(false);
    expect((await checkRateLimit(key, 1, 1000, 11_001)).allowed).toBe(true);
  });
});
