import { describe, expect, it } from "vitest";
import type { AgentRow, RunRow } from "@/server/db";
import type { RunReport } from "@/engine/types";
import { buildAgentDashboard, toPublicAgent } from "@/server/agent-store";

const agent: AgentRow = {
  id: "agent-1",
  workspaceId: "workspace_local",
  name: "Support",
  clientName: "Acme",
  endpointUrl: "https://agent.example.com",
  protocol: "openai",
  authType: "bearer",
  authToken: "secret",
  authHeaderName: null,
  systemPrompt: "private prompt",
  agentFamily: "openai",
  mode: "auto",
  tools: [{ name: "lookup", description: "Lookup" }],
  active: true,
  source: "manual",
  externalId: null,
  lastTraceAt: null,
  createdAt: 1,
  updatedAt: 1,
};

function report(score: number, suite: "balanced" | "safety"): RunReport {
  return {
    suite,
    score,
    certified: score >= 0.9,
    categories: [],
    scenarioResults: [],
    fixes: [],
    judgeModel: "test",
    judgeFamilyDisclaimer: null,
    totals: { scenarios: 0, passed: 0, conversations: 0, unevaluated: 0 },
    profile: {
      summary: "test",
      mode: "conversational",
      modeConfidence: "low",
      modeRationale: "test",
      domain: "test",
      capabilities: [],
      boundaries: [],
      failureModes: [],
      riskAreas: [],
      toolsDetected: [],
    },
  };
}

function run(id: string, createdAt: number, score: number | null = null, suite: "balanced" | "safety" | null = null): RunRow {
  return {
    id,
    workspaceId: "workspace_local",
    agentId: "agent-1",
    agentName: "Support",
    clientName: "Acme",
    endpointUrl: agent.endpointUrl,
    status: "done",
    progress: null,
    report: score === null || suite === null ? null : report(score, suite),
    error: null,
    createdAt,
  };
}

describe("agent dashboard projection", () => {
  it("does not expose prompts or auth tokens", () => {
    const publicAgent = toPublicAgent(agent);
    expect(publicAgent).not.toHaveProperty("authToken");
    expect(publicAgent).not.toHaveProperty("systemPrompt");
    expect(publicAgent.toolCount).toBe(1);
    expect(publicAgent.authConfigured).toBe(true);
  });

  it("groups the newest eight runs by agent", () => {
    const rows = buildAgentDashboard(
      [agent],
      [run("old", 1), run("new", 3), run("middle", 2)],
    );
    expect(rows[0]?.latestRun?.id).toBe("new");
    expect(rows[0]?.latestTrace).toBeNull();
    expect(rows[0]?.history.map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("calculates regression deltas only within the same suite", () => {
    const sameSuite = buildAgentDashboard([agent], [run("new", 3, 0.84, "safety"), run("old", 2, 0.9, "safety")]);
    expect(sameSuite[0]?.scoreDelta).toBeCloseTo(-0.06);

    const differentSuite = buildAgentDashboard([agent], [run("new", 3, 0.84, "safety"), run("old", 2, 0.9, "balanced")]);
    expect(differentSuite[0]?.scoreDelta).toBeNull();
  });
});
