import { randomUUID } from "node:crypto";
import type { AgentConnection } from "@/engine/connector";
import { suiteMix, type TestSuite } from "@/engine/suites";
import type { EvalMode, RunConfig, ToolDefinition } from "@/engine/types";
import type { AgentRow, RunRow, RunStatus } from "./db";
import { getAgentByExternalId, insertAgent, listAgents, listRuns } from "./db";
import type { StartRunInput } from "./run-store";
import { getDefaultWorkspace } from "./workspace-store";
import { getAgentTraces, type TraceSummary } from "./trace-store";

export interface CreateAgentInput {
  name: string;
  clientName: string | null;
  endpointUrl: string;
  protocol: AgentConnection["protocol"];
  authType: AgentConnection["authType"];
  authToken?: string;
  authHeaderName?: string;
  systemPrompt: string;
  agentFamily: AgentRow["agentFamily"];
  mode?: AgentRow["mode"];
  tools: ToolDefinition[];
}

export interface PublicAgent {
  id: string;
  workspaceId: string;
  name: string;
  clientName: string | null;
  endpointUrl: string;
  protocol: AgentRow["protocol"];
  authType: AgentRow["authType"];
  authHeaderName: string | null;
  agentFamily: AgentRow["agentFamily"];
  mode: AgentRow["mode"];
  toolCount: number;
  active: boolean;
  authConfigured: boolean;
  source: AgentRow["source"];
  externalId: string | null;
  lastTraceAt: number | null;
  canRun: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRunSummary {
  id: string;
  status: RunStatus;
  score: number | null;
  certified: boolean | null;
  createdAt: number;
  error: string | null;
  suite: TestSuite | null;
}

export interface AgentDashboardRow {
  agent: PublicAgent;
  latestRun: AgentRunSummary | null;
  latestTrace: TraceSummary | null;
  history: AgentRunSummary[];
  scoreDelta: number | null;
}

export interface AgentRegistration {
  id?: string;
  name: string;
  clientName?: string;
  endpointUrl?: string;
  protocol?: AgentRow["protocol"];
  systemPrompt?: string;
  agentFamily?: AgentRow["agentFamily"];
  mode?: AgentRow["mode"];
  source: AgentRow["source"];
  externalId?: string;
}

export type RegisterAgentResult =
  | { ok: true; value: AgentRow; created: boolean }
  | { ok: false; error: "workspace_agent_exists" };

export function toPublicAgent(agent: AgentRow): PublicAgent {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    name: agent.name,
    clientName: agent.clientName,
    endpointUrl: agent.endpointUrl,
    protocol: agent.protocol,
    authType: agent.authType,
    authHeaderName: agent.authHeaderName,
    agentFamily: agent.agentFamily,
    mode: agent.mode,
    toolCount: agent.tools.length,
    active: agent.active,
    authConfigured:
      agent.authType === "none" ||
      Boolean(agent.authToken && (agent.authType !== "header" || agent.authHeaderName)),
    source: agent.source,
    externalId: agent.externalId,
    lastTraceAt: agent.lastTraceAt,
    canRun: Boolean(agent.endpointUrl && agent.systemPrompt),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export function registerWorkspaceAgent(
  workspaceId: string,
  input: AgentRegistration,
): RegisterAgentResult {
  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    const existing = getAgentByExternalId(workspaceId, externalId);
    if (existing) return { ok: true, value: existing, created: false };
  }
  const now = Date.now();
  const agent: AgentRow = {
    id: input.id?.trim() || randomUUID(),
    workspaceId,
    name: input.name.trim(),
    clientName: input.clientName?.trim() || null,
    endpointUrl: input.endpointUrl?.trim() || "",
    protocol: input.protocol ?? "openai",
    authType: "none",
    authToken: null,
    authHeaderName: null,
    systemPrompt: input.systemPrompt?.trim() || "",
    agentFamily: input.agentFamily ?? "unknown",
    mode: input.mode ?? "auto",
    tools: [],
    active: true,
    source: input.source,
    externalId,
    lastTraceAt: null,
    createdAt: now,
    updatedAt: now,
  };
  insertAgent(agent);
  return { ok: true, value: agent, created: true };
}

export function summarizeRun(run: RunRow): AgentRunSummary {
  return {
    id: run.id,
    status: run.status,
    score: run.report?.score ?? null,
    certified: run.report?.certified ?? null,
    createdAt: run.createdAt,
    error: run.error,
    suite: run.report?.suite ?? null,
  };
}

export function buildAgentDashboard(
  agents: AgentRow[],
  runs: RunRow[],
  traces: TraceSummary[] = [],
): AgentDashboardRow[] {
  return agents.map((agent) => {
    const history = runs
      .filter((run) => run.agentId === agent.id)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 8)
      .map(summarizeRun);
    const scored = history.filter((run) => run.score !== null);
    const latestScored = scored[0];
    const previousScored = latestScored
      ? scored.find((run) => run.suite === latestScored.suite && run.id !== latestScored.id)
      : undefined;
    return {
      agent: toPublicAgent(agent),
      latestRun: history[0] ?? null,
      latestTrace: traces.find((trace) => trace.agentId === agent.id) ?? null,
      history,
      scoreDelta:
        latestScored && previousScored && latestScored.score !== null && previousScored.score !== null
          ? latestScored.score - previousScored.score
          : null,
    };
  });
}

export function createAgent(input: CreateAgentInput): AgentRow {
  const now = Date.now();
  const agent: AgentRow = {
    id: randomUUID(),
    workspaceId: getDefaultWorkspace().id,
    name: input.name,
    clientName: input.clientName,
    endpointUrl: input.endpointUrl,
    protocol: input.protocol,
    authType: input.authType,
    authToken: input.authToken?.trim() || null,
    authHeaderName: input.authHeaderName?.trim() || null,
    systemPrompt: input.systemPrompt,
    agentFamily: input.agentFamily,
    mode: input.mode ?? "auto",
    tools: input.tools,
    active: true,
    source: "manual",
    externalId: null,
    lastTraceAt: null,
    createdAt: now,
    updatedAt: now,
  };
  insertAgent(agent);
  return agent;
}

export function getAgentDashboard(workspaceId = getDefaultWorkspace().id): AgentDashboardRow[] {
  const agents = listAgents(workspaceId);
  const traces = agents.flatMap((agent) => getAgentTraces(workspaceId, agent.id, 1));
  return buildAgentDashboard(agents, listRuns(workspaceId), traces);
}

export function toStartRunInput(
  agent: AgentRow,
  config?: Partial<RunConfig>,
  subscriptionConnectionId?: string,
): StartRunInput {
  const connection: AgentConnection = {
    endpointUrl: agent.endpointUrl,
    protocol: agent.protocol,
    authType: agent.authType,
    authToken: agent.authToken ?? undefined,
    authHeaderName: agent.authHeaderName ?? undefined,
  };
  return {
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    agentName: agent.name,
    clientName: agent.clientName,
    connection,
    agentSystemPrompt: agent.systemPrompt,
    agentFamily: agent.agentFamily,
    mode: agent.mode && agent.mode !== "auto" ? agent.mode : undefined,
    tools: agent.tools,
    config,
    subscriptionConnectionId,
  };
}

export function runConfigForPreset(
  scenarioCount: number,
  k: number,
  suite: TestSuite = "balanced",
): Partial<RunConfig> {
  return {
    suite,
    scenarioCount,
    mix: suiteMix(suite, scenarioCount),
    k,
  };
}

export function isEvalMode(value: unknown): value is "auto" | EvalMode {
  return value === "auto" || value === "conversational" || value === "task";
}

export function parseTools(raw: unknown): ToolDefinition[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const tools: ToolDefinition[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.description !== "string") {
      return null;
    }
    const parameters = item.parameters;
    tools.push({
      name: item.name,
      description: item.description,
      parameters: isRecord(parameters) ? parameters : undefined,
    });
  }
  return tools;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
