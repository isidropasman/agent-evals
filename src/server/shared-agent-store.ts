import { randomUUID } from "node:crypto";
import type { AgentRow } from "./db";
import { buildAgentDashboard, toPublicAgent, type AgentDashboardRow, type AgentRegistration, type CreateAgentInput } from "./agent-store";
import { sharedGetAgentByExternalId, sharedInsertAgent, sharedListAgents, sharedListRuns, sharedListTraces } from "./shared-store";

export type SharedRegisterResult =
  | { ok: true; value: AgentRow; created: boolean }
  | { ok: false; error: "workspace_agent_exists" | "storage_unavailable" };

export async function registerSharedAgent(workspaceId: string, input: AgentRegistration): Promise<SharedRegisterResult> {
  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    const existing = await sharedGetAgentByExternalId(workspaceId, externalId);
    if (existing) return { ok: true, value: existing, created: false };
  }
  const now = Date.now();
  const agent: AgentRow = {
    id: input.id?.trim() || randomUUID(), workspaceId, name: input.name.trim(),
    clientName: input.clientName?.trim() || null, endpointUrl: input.endpointUrl?.trim() || "",
    protocol: input.protocol ?? "openai", authType: "none", authToken: null,
    authHeaderName: null, systemPrompt: input.systemPrompt?.trim() || "", agentFamily: input.agentFamily ?? "unknown",
    mode: input.mode ?? "auto", tools: [], active: true, source: input.source, externalId,
    lastTraceAt: null, createdAt: now, updatedAt: now,
  };
  const inserted = await sharedInsertAgent(agent);
  if (!inserted.ok) return { ok: false, error: "storage_unavailable" };
  if (!inserted.value) {
    const existing = externalId
      ? await sharedGetAgentByExternalId(workspaceId, externalId)
      : await import("./shared-store").then((module) => module.sharedGetAgent(agent.id, workspaceId));
    if (existing) return { ok: true, value: existing, created: false };
    return { ok: false, error: "workspace_agent_exists" };
  }
  return { ok: true, value: agent, created: true };
}

export async function createSharedAgent(workspaceId: string, input: CreateAgentInput): Promise<AgentRow | null> {
  const now = Date.now();
  const agent: AgentRow = { id: randomUUID(), workspaceId, name: input.name, clientName: input.clientName, endpointUrl: input.endpointUrl, protocol: input.protocol, authType: input.authType, authToken: input.authToken ?? null, authHeaderName: input.authHeaderName ?? null, systemPrompt: input.systemPrompt, agentFamily: input.agentFamily, mode: input.mode ?? "auto", tools: input.tools, active: true, source: "manual", externalId: null, lastTraceAt: null, createdAt: now, updatedAt: now };
  const inserted = await sharedInsertAgent(agent);
  return inserted.ok && inserted.value ? agent : null;
}

export async function getSharedAgentDashboard(workspaceId: string): Promise<AgentDashboardRow[]> {
  const agents = await sharedListAgents(workspaceId);
  const traces = (await Promise.all(agents.map((agent) => sharedListTraces(workspaceId, 1, agent.id)))).flat().map((trace) => ({
    traceId: trace.traceId, eventId: trace.eventId, agentId: trace.agentId, deployment: trace.deployment,
    version: trace.version, kind: trace.kind as "run" | "turn" | "tool_call" | "tool_result" | "assertion",
    toolName: trace.toolName, latencyMs: trace.latencyMs, status: trace.status as "ok" | "error" | null,
    assertion: trace.assertion as { name: string; passed: boolean; detail?: string } | null,
    occurredAt: trace.occurredAt, metadata: trace.metadata,
  }));
  return buildAgentDashboard(agents, await sharedListRuns(workspaceId), traces);
}

export { toPublicAgent };
