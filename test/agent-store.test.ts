import { describe, expect, it } from "vitest";
import type { AgentRow, RunRow } from "@/server/db";
import { buildAgentDashboard, toPublicAgent } from "@/server/agent-store";

const agent: AgentRow = {
  id: "agent-1",
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
  createdAt: 1,
  updatedAt: 1,
};

function run(id: string, createdAt: number): RunRow {
  return {
    id,
    agentId: "agent-1",
    agentName: "Support",
    clientName: "Acme",
    endpointUrl: agent.endpointUrl,
    status: "done",
    progress: null,
    report: null,
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
    expect(rows[0]?.history.map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });
});
