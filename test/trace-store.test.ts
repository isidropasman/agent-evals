import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAgent } from "@/server/agent-store";
import { insertAgent, insertWorkspace, type AgentRow } from "@/server/db";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { getAgentTrace, getAgentTraces, getWorkspaceTraceStats, ingestTrace } from "@/server/trace-store";

describe("trace store", () => {
  it("ingests idempotently and exposes only a redacted summary", () => {
    const workspace = getDefaultWorkspace();
    const suffix = randomUUID();
    const agent = createAgent({
      name: "Trace test",
      clientName: null,
      endpointUrl: "https://agent.example.com",
      protocol: "openai",
      authType: "none",
      systemPrompt: "test",
      agentFamily: "unknown",
      tools: [],
    });
    const envelope = {
      traceId: `trace-test-${suffix}`,
      eventId: `event-test-${suffix}`,
      agentId: agent.id,
      kind: "turn" as const,
      input: { prompt: "hello", apiKey: "do-not-store" },
      output: { text: "world" },
      occurredAt: 10,
    };

    expect(ingestTrace(workspace.id, envelope)).toEqual({
      ok: true,
      value: { inserted: true, traceId: `trace-test-${suffix}` },
    });
    expect(ingestTrace(workspace.id, envelope)).toEqual({
      ok: true,
      value: { inserted: false, traceId: `trace-test-${suffix}` },
    });
    expect(getAgentTraces(workspace.id, agent.id)).toHaveLength(1);
    expect(getAgentTrace(workspace.id, agent.id, `trace-test-${suffix}`)).toMatchObject({
      traceId: `trace-test-${suffix}`,
      kind: "turn",
    });
    expect(getAgentTrace(workspace.id, agent.id, `trace-test-${suffix}`)).not.toHaveProperty("input");
  });

  it("rejects traces from another workspace", () => {
    const workspace = getDefaultWorkspace();
    expect(ingestTrace("another-workspace", {
      traceId: "missing-agent-trace",
      eventId: "missing-agent-event",
      agentId: "missing-agent",
      kind: "run",
      occurredAt: 10,
    })).toEqual({ ok: false, error: "agent_not_found" });
    expect(getAgentTraces(workspace.id, "missing-agent")).toEqual([]);
  });

  it("computes operational stats without exposing payloads", () => {
    const workspace = { id: `stats-${randomUUID()}`, name: "Stats workspace", createdAt: Date.now() };
    insertWorkspace(workspace);
    const agent: AgentRow = {
      id: randomUUID(),
      workspaceId: workspace.id,
      name: "Stats test",
      clientName: null,
      endpointUrl: "https://agent.example.com",
      protocol: "openai",
      authType: "none",
      authToken: null,
      authHeaderName: null,
      systemPrompt: "test",
      agentFamily: "unknown",
      mode: "auto",
      tools: [],
      active: true,
      source: "manual",
      externalId: null,
      lastTraceAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    insertAgent(agent);
    const now = Date.now();
    const before = getWorkspaceTraceStats(workspace.id, now);
    expect(ingestTrace(workspace.id, {
      traceId: randomUUID(),
      eventId: randomUUID(),
      agentId: agent.id,
      kind: "tool_call",
      toolName: "lookup",
      status: "error",
      occurredAt: now,
    }).ok).toBe(true);
    expect(ingestTrace(workspace.id, {
      traceId: randomUUID(),
      eventId: randomUUID(),
      agentId: agent.id,
      kind: "assertion",
      assertion: { name: "safe", passed: false },
      occurredAt: now,
    }).ok).toBe(true);
    expect(getWorkspaceTraceStats(workspace.id, now)).toMatchObject({
      last24h: before.last24h + 2,
      errors: before.errors + 1,
      failedAssertions: before.failedAssertions + 1,
      toolCalls: before.toolCalls + 1,
    });
  });
});
