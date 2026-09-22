import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "@/mcp/server";
import { getDefaultWorkspace, createWorkspaceKey } from "@/server/workspace-store";
import { createAgent } from "@/server/agent-store";
import { ingestTrace } from "@/server/trace-store";
import { randomUUID } from "node:crypto";

describe("MCP control surface", () => {
  it("initializes and lists typed tools", async () => {
    const workspace = getDefaultWorkspace();
    const initialized = await handleMcpRequest(workspace.id, { jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(initialized?.result).toMatchObject({ capabilities: { tools: {} } });
    const listed = await handleMcpRequest(workspace.id, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(listed?.result).toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: "run_suite" }), expect.objectContaining({ name: "run_gate" }), expect.objectContaining({ name: "connect_codex" })]) });
  });

  it("registers an observed agent and refuses a black-box run without endpoint", async () => {
    const workspace = getDefaultWorkspace();
    const registered = await handleMcpRequest(workspace.id, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "register_agent", arguments: { name: "MCP observed", externalId: `mcp-${Date.now()}` } },
    });
    const toolResult = registered?.result as { structuredContent?: { agent?: { id: string } } };
    const agentId = toolResult.structuredContent?.agent?.id;
    expect(agentId).toBeTruthy();
    const run = await handleMcpRequest(workspace.id, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "run_suite", arguments: { agentId } },
    });
    expect(run?.result).toMatchObject({ isError: true });
  });

  it("never returns a run from another workspace", async () => {
    const workspace = getDefaultWorkspace();
    const key = createWorkspaceKey(workspace.id, "mcp test");
    expect(key.ok).toBe(true);
    const agent = createAgent({
      name: "MCP source",
      clientName: null,
      endpointUrl: "https://agent.example.com",
      protocol: "openai",
      authType: "none",
      systemPrompt: "test",
      agentFamily: "unknown",
      tools: [],
    });
    const response = await handleMcpRequest("other-workspace", {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_trace", arguments: { agentId: agent.id, traceId: "private" } },
    });
    expect(response?.result).toMatchObject({ isError: true });
  });

  it("promotes observed evidence into a replayable case", async () => {
    const workspace = getDefaultWorkspace();
    const traceId = randomUUID();
    const agent = createAgent({
      name: "MCP regression source",
      clientName: null,
      endpointUrl: "https://agent.example.com",
      protocol: "openai",
      authType: "none",
      systemPrompt: "Protect users.",
      agentFamily: "unknown",
      tools: [],
    });
    ingestTrace(workspace.id, {
      agentId: agent.id,
      traceId,
      eventId: randomUUID(),
      kind: "assertion",
      input: "do not reveal secrets",
      assertion: { name: "refuses secret disclosure", passed: false },
      occurredAt: Date.now(),
    });
    const response = await handleMcpRequest(workspace.id, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "promote_trace", arguments: { agentId: agent.id, traceId } },
    });
    expect(response?.result).toMatchObject({ structuredContent: { case: { sourceTraceId: traceId } } });
  });
});
