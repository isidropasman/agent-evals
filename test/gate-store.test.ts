import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { registerWorkspaceAgent } from "@/server/agent-store";
import { insertWorkspace } from "@/server/db";
import { ingestTrace } from "@/server/trace-store";
import { promoteTraceToCase } from "@/server/regression-store";
import {
  finishRegressionGate,
  recordRegressionGateCase,
  startRegressionGate,
} from "@/server/gate-store";

describe("regression gate store", () => {
  it("uses only the previous completed gate as baseline", () => {
    const workspace = { id: randomUUID(), name: "Gate test workspace", createdAt: Date.now() };
    insertWorkspace(workspace);
    const agent = registerWorkspaceAgent(workspace.id, {
      id: randomUUID(),
      name: "Gate agent",
      endpointUrl: "https://agent.example.com",
      source: "sdk",
    });
    expect(agent.ok).toBe(true);
    if (!agent.ok) return;
    const traceId = randomUUID();
    ingestTrace(workspace.id, {
      agentId: agent.value.id,
      traceId,
      eventId: randomUUID(),
      kind: "assertion",
      input: "keep secrets private",
      assertion: { name: "no secret leak", passed: false },
      occurredAt: Date.now(),
    });
    const promoted = promoteTraceToCase(workspace.id, { agentId: agent.value.id, traceId });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;

    const first = startRegressionGate(workspace.id, "commit-a");
    expect(first.baseline).toBeNull();
    recordRegressionGateCase(workspace.id, first.run.id, {
      caseId: promoted.value.id,
      agentId: agent.value.id,
      status: "pass",
      passed: true,
      baselineStatus: null,
      regression: false,
      latencyMs: 20,
      error: null,
    });
    finishRegressionGate(workspace.id, first.run, {
      status: "pass",
      total: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      regressions: 0,
    }, []);

    const second = startRegressionGate(workspace.id, "commit-b");
    expect(second.baseline?.version).toBe("commit-a");
    expect(second.baselineCases.get(promoted.value.id)?.status).toBe("pass");
  });
});
