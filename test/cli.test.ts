import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, runConfigFrom } from "@/cli/config";
import { passesGate } from "@/cli/report";
import { waitForReady } from "@/cli/launch";
import type { AgentConnection } from "@/engine/connector";
import type { ResolvedRun } from "@/cli/config";
import type { RunReport } from "@/engine/types";

function tmpConfig(obj: unknown, promptContent?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gauntlet-cli-"));
  const cfgPath = path.join(dir, "gauntlet.config.json");
  writeFileSync(cfgPath, JSON.stringify(obj));
  if (promptContent !== undefined) {
    writeFileSync(path.join(dir, "prompt.txt"), promptContent);
  }
  return cfgPath;
}

describe("loadConfig", () => {
  it("loads a valid config and reads the prompt file", () => {
    const cfg = tmpConfig(
      {
        agentName: "Test",
        endpointUrl: "https://x.com/chat",
        systemPromptFile: "./prompt.txt",
      },
      "You are a helpful agent.",
    );
    const r = loadConfig(cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.agentName).toBe("Test");
      expect(r.value.systemPrompt).toBe("You are a helpful agent.");
      expect(r.value.connection.endpointUrl).toBe("https://x.com/chat");
    }
  });

  it("prefers inline systemPrompt over the file", () => {
    const cfg = tmpConfig(
      { agentName: "T", endpointUrl: "https://x.com", systemPrompt: "inline" },
      "from file",
    );
    const r = loadConfig(cfg);
    expect(r.ok && r.value.systemPrompt).toBe("inline");
  });

  it("errors when the prompt source is missing", () => {
    const cfg = tmpConfig({ agentName: "T", endpointUrl: "https://x.com" });
    const r = loadConfig(cfg);
    expect(r.ok).toBe(false);
  });

  it("errors on a missing endpointUrl", () => {
    const cfg = tmpConfig({ agentName: "T", systemPrompt: "p" });
    const r = loadConfig(cfg);
    expect(r.ok).toBe(false);
  });

  it("errors when the config file does not exist", () => {
    const r = loadConfig("/nonexistent/gauntlet.config.json");
    expect(r.ok).toBe(false);
  });

  it("applies gate + mix defaults", () => {
    const cfg = tmpConfig(
      { agentName: "T", endpointUrl: "https://x.com", systemPrompt: "p" },
    );
    const r = loadConfig(cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.gate.minScore).toBe(0.9);
      expect(r.value.k).toBe(4);
      const rc = runConfigFrom(r.value);
      expect(rc.mix.happy_path + rc.mix.edge_case + rc.mix.adversarial).toBe(50);
    }
  });
});

describe("passesGate", () => {
  const run = {
    gate: { minScore: 0.9, minCategoryRate: 0.8 },
  } as ResolvedRun;

  function reportWith(score: number, rates: [number, number, number]): RunReport {
    return {
      score,
      certified: false,
      categories: [
        { category: "happy_path", total: 10, passed: 0, rate: rates[0] },
        { category: "edge_case", total: 10, passed: 0, rate: rates[1] },
        { category: "adversarial", total: 10, passed: 0, rate: rates[2] },
      ],
      scenarioResults: [],
      fixes: [],
      judgeModel: "m",
      judgeFamilyDisclaimer: null,
      totals: { scenarios: 30, passed: 0, conversations: 120 },
    };
  }

  it("passes when score and all category rates clear the gate", () => {
    expect(passesGate(reportWith(0.95, [1, 0.9, 0.85]), run)).toBe(true);
  });

  it("fails when score is below the gate", () => {
    expect(passesGate(reportWith(0.85, [1, 1, 1]), run)).toBe(false);
  });

  it("fails when one category is below the floor even if score passes", () => {
    expect(passesGate(reportWith(0.92, [1, 1, 0.5]), run)).toBe(false);
  });
});

describe("waitForReady", () => {
  const conn: AgentConnection = {
    endpointUrl: "http://127.0.0.1:9/chat",
    protocol: "openai",
    authType: "none",
  };
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves once the readyPath returns 200", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("", { status: calls >= 2 ? 200 : 503 });
    }) as typeof fetch;
    const r = await waitForReady(conn, "/health", 5, async () => {});
    expect(r.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("times out if never ready", async () => {
    globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
    // 0s timeout → deadline already passed, one loop max
    const r = await waitForReady(conn, "/health", 0, async () => {});
    expect(r.ok).toBe(false);
  });
});
