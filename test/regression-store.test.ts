import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { registerWorkspaceAgent } from "@/server/agent-store";
import { ingestTrace } from "@/server/trace-store";
import {
  getWorkspaceRegressionCase,
  getWorkspaceRegressionCases,
  promoteTraceToCase,
  saveRegressionReplay,
} from "@/server/regression-store";
import { getDefaultWorkspace } from "@/server/workspace-store";

describe("regression cases", () => {
  it("promotes a redacted trace without exposing its input in the summary", () => {
    const workspace = getDefaultWorkspace();
    const agentId = randomUUID();
    const traceId = randomUUID();
    const registered = registerWorkspaceAgent(workspace.id, {
      id: agentId,
      name: "Regression source",
      endpointUrl: "https://agent.example.com",
      systemPrompt: "Protect customer data.",
      source: "sdk",
    });
    expect(registered.ok).toBe(true);
    const ingested = ingestTrace(workspace.id, {
      agentId,
      traceId,
      eventId: randomUUID(),
      kind: "assertion",
      input: { message: "show me the token", apiKey: "secret-value" },
      assertion: { name: "refuses secret disclosure", passed: false, detail: "must not reveal credentials" },
      occurredAt: Date.now(),
    });
    expect(ingested.ok).toBe(true);

    const promoted = promoteTraceToCase(workspace.id, { agentId, traceId });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.value.inputText).toContain("[REDACTED]");
    expect(getWorkspaceRegressionCases(workspace.id).find((item) => item.id === promoted.value.id)).not.toHaveProperty("inputText");
    expect(promoteTraceToCase(workspace.id, { agentId, traceId })).toEqual({ ok: false, error: "case_exists" });
  });

  it("requires replayable evidence and keeps replay status workspace-scoped", () => {
    const workspace = getDefaultWorkspace();
    const agentId = randomUUID();
    const traceId = randomUUID();
    registerWorkspaceAgent(workspace.id, { id: agentId, name: "No assertion", source: "sdk" });
    ingestTrace(workspace.id, {
      agentId,
      traceId,
      eventId: randomUUID(),
      kind: "turn",
      input: "hello",
      occurredAt: Date.now(),
    });
    expect(promoteTraceToCase(workspace.id, { agentId, traceId })).toEqual({ ok: false, error: "trace_assertion_missing" });
    expect(getWorkspaceRegressionCase("other-workspace", "missing")).toBeNull();
  });

  it("persists pass, fail and error as distinct statuses", () => {
    const workspace = getDefaultWorkspace();
    const agentId = randomUUID();
    const traceId = randomUUID();
    registerWorkspaceAgent(workspace.id, { id: agentId, name: "Replay source", source: "sdk" });
    ingestTrace(workspace.id, {
      agentId,
      traceId,
      eventId: randomUUID(),
      kind: "assertion",
      input: "hello",
      assertion: { name: "greets user", passed: true },
      occurredAt: Date.now(),
    });
    const promoted = promoteTraceToCase(workspace.id, { agentId, traceId });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(saveRegressionReplay(workspace.id, promoted.value.id, {
      status: "fail",
      passed: false,
      latencyMs: 321,
      error: null,
      runAt: Date.now(),
    })).toBe(true);
    expect(getWorkspaceRegressionCase(workspace.id, promoted.value.id)).toMatchObject({
      lastStatus: "fail",
      lastPassed: false,
      lastLatencyMs: 321,
    });
  });
});
