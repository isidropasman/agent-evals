import { randomUUID } from "node:crypto";
import type { AgentConnection } from "@/engine/connector";
import type { EvalMode, RunConfig, ToolDefinition } from "@/engine/types";
import type { AgentRow, RunRow, RunStatus } from "./db";
import { insertAgent, listAgents, listRuns } from "./db";
import type { StartRunInput } from "./run-store";

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
}

export interface AgentDashboardRow {
  agent: PublicAgent;
  latestRun: AgentRunSummary | null;
  history: AgentRunSummary[];
}

export function toPublicAgent(agent: AgentRow): PublicAgent {
  return {
    id: agent.id,
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
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export function summarizeRun(run: RunRow): AgentRunSummary {
  return {
    id: run.id,
    status: run.status,
    score: run.report?.score ?? null,
    certified: run.report?.certified ?? null,
    createdAt: run.createdAt,
    error: run.error,
  };
}

export function buildAgentDashboard(agents: AgentRow[], runs: RunRow[]): AgentDashboardRow[] {
  return agents.map((agent) => {
    const history = runs
      .filter((run) => run.agentId === agent.id)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 8)
      .map(summarizeRun);
    return {
      agent: toPublicAgent(agent),
      latestRun: history[0] ?? null,
      history,
    };
  });
}

export function createAgent(input: CreateAgentInput): AgentRow {
  const now = Date.now();
  const agent: AgentRow = {
    id: randomUUID(),
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
    createdAt: now,
    updatedAt: now,
  };
  insertAgent(agent);
  return agent;
}

export function getAgentDashboard(): AgentDashboardRow[] {
  return buildAgentDashboard(listAgents(), listRuns());
}

export function toStartRunInput(
  agent: AgentRow,
  config?: Partial<RunConfig>,
): StartRunInput {
  const connection: AgentConnection = {
    endpointUrl: agent.endpointUrl,
    protocol: agent.protocol,
    authType: agent.authType,
    authToken: agent.authToken ?? undefined,
    authHeaderName: agent.authHeaderName ?? undefined,
  };
  return {
    agentId: agent.id,
    agentName: agent.name,
    clientName: agent.clientName,
    connection,
    agentSystemPrompt: agent.systemPrompt,
    agentFamily: agent.agentFamily,
    mode: agent.mode && agent.mode !== "auto" ? agent.mode : undefined,
    tools: agent.tools,
    config,
  };
}

export function runConfigForPreset(scenarioCount: number, k: number): Partial<RunConfig> {
  const happy = Math.max(1, Math.round(scenarioCount * 0.4));
  const edge = Math.max(1, Math.round(scenarioCount * 0.3));
  const adversarial = Math.max(1, scenarioCount - happy - edge);
  return {
    scenarioCount,
    mix: { happy_path: happy, edge_case: edge, adversarial },
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
