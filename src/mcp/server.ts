import { randomUUID } from "node:crypto";
import { isTestSuite } from "@/engine/suites";
import { getAgent, getRun, listAgents } from "@/server/db";
import {
  registerWorkspaceAgent,
  runConfigForPreset,
  toPublicAgent,
  toStartRunInput,
} from "@/server/agent-store";
import { getAgentTrace } from "@/server/trace-store";
import { startRunAsync } from "@/server/run-store";
import { MCP_TOOLS, type McpRequest, type McpResponse } from "./protocol";
import { parseAgentRegistration } from "@/server/http-input";
import { parsePromoteTrace } from "@/server/http-input";
import {
  getWorkspaceRegressionCases,
  promoteTraceToCase,
  toRegressionCaseSummary,
} from "@/server/regression-store";
import { executeRegressionCase } from "@/server/regression-runner";
import { parseRegressionGateInput } from "@/server/http-input";
import { runWorkspaceRegressionGate } from "@/server/gate-runner";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedGetAgent, sharedGetRun, sharedGetTrace, sharedListAgents } from "@/server/shared-store";
import { registerSharedAgent } from "@/server/shared-agent-store";
import { listSharedRegressionCases, promoteSharedTrace, executeSharedRegressionCase } from "@/server/shared-regression-store";
import { enqueueGate } from "@/server/durable-gates";
import { createDatasetVersion, listDatasetVersions } from "@/server/dataset-store";
import { parseDatasetVersionInput } from "@/server/http-input";

export async function handleMcpRequest(
  workspaceId: string,
  request: McpRequest,
): Promise<McpResponse | null> {
  const id = request.id ?? null;
  if (request.method === "notifications/initialized") return null;
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "gauntlet", version: "0.1.0" },
      },
    };
  }
  if (request.method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }
  if (request.method !== "tools/call") return errorResponse(id, -32601, "method not found");
  const params = request.params;
  if (!isRecord(params) || typeof params.name !== "string") {
    return errorResponse(id, -32602, "tools/call requiere name");
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  return { jsonrpc: "2.0", id, result: await callTool(workspaceId, params.name, args) };
}

function errorResponse(id: McpResponse["id"], code: number, message: string): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function callTool(
  workspaceId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "list_agents":
      return success({ agents: sharedDatabaseEnabled() ? (await sharedListAgents(workspaceId)).map(toPublicAgent) : listAgents(workspaceId).map(toPublicAgent) });
    case "register_agent":
      return registerAgent(workspaceId, args);
    case "run_suite":
      return runSuite(workspaceId, args);
    case "get_run":
      return getRunSummary(workspaceId, args);
    case "get_trace":
      return getTraceSummary(workspaceId, args);
    case "list_cases":
      return success({ cases: sharedDatabaseEnabled() ? await listSharedRegressionCases(workspaceId) : getWorkspaceRegressionCases(workspaceId) });
    case "promote_trace":
      return promoteTrace(workspaceId, args);
    case "replay_case":
      return replayCase(workspaceId, args);
    case "run_gate":
      return runGate(workspaceId, args);
    case "list_datasets":
      return success({ datasets: await listDatasetVersions(workspaceId) });
    case "create_dataset":
      return createDataset(workspaceId, args);
    default:
      return failure(`tool no encontrada: ${name}`);
  }
}

async function createDataset(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseDatasetVersionInput(args);
  if (!parsed.ok) return failure(parsed.error);
  const result = await createDatasetVersion(workspaceId, parsed.value.name, parsed.value.version, parsed.value.items);
  return result.ok ? success({ dataset: result.value, created: result.created }) : failure(result.message);
}

async function registerAgent(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseAgentRegistration({ ...args, source: "mcp" });
  if (!parsed.ok) return failure(parsed.error);
  const result = sharedDatabaseEnabled() ? await registerSharedAgent(workspaceId, parsed.value) : registerWorkspaceAgent(workspaceId, parsed.value);
  if (!result.ok) return failure("agent already exists");
  return success({ created: result.created, agent: toPublicAgent(result.value) });
}

async function runSuite(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const agentId = stringValue(args.agentId);
  const suite = args.suite === undefined ? "balanced" : args.suite;
  const scenarioCount = args.scenarioCount === undefined ? 10 : args.scenarioCount;
  const k = args.k === undefined ? 1 : args.k;
  if (!agentId || !isTestSuite(suite) || !isPresetNumber(scenarioCount, [10, 50]) || !isPresetNumber(k, [1, 4])) {
    return failure("agentId, suite, scenarioCount o k inválidos");
  }
  const agent = sharedDatabaseEnabled() ? await sharedGetAgent(agentId, workspaceId) : getAgent(agentId, workspaceId);
  if (!agent) return failure("agent not found");
  if (!agent.active) return failure("agent inactivo");
  if (!agent.endpointUrl || !agent.systemPrompt) return failure("agent observado: necesita endpoint y system prompt para black-box run");
  const runId = randomUUID();
  if (!await startRunAsync(runId, toStartRunInput(agent, runConfigForPreset(scenarioCount, k, suite)))) return failure("no se pudo crear la corrida");
  return success({ runId, suite, scenarioCount, k });
}

async function getRunSummary(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const runId = stringValue(args.runId);
  if (!runId) return failure("runId es obligatorio");
  const run = sharedDatabaseEnabled() ? await sharedGetRun(workspaceId, runId) : getRun(runId, workspaceId);
  if (!run) return failure("run not found");
  return success({
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    progress: run.progress,
    score: run.report?.score ?? null,
    certified: run.report?.certified ?? null,
    suite: run.report?.suite ?? null,
    error: run.error,
    createdAt: run.createdAt,
  });
}

async function getTraceSummary(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const agentId = stringValue(args.agentId);
  const traceId = stringValue(args.traceId);
  if (!agentId || !traceId) return failure("agentId y traceId son obligatorios");
  const trace = sharedDatabaseEnabled() ? await sharedGetTrace(workspaceId, agentId, traceId) : getAgentTrace(workspaceId, agentId, traceId);
  return trace ? success({ trace }) : failure("trace not found");
}

async function promoteTrace(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parsePromoteTrace(args);
  if (!parsed.ok) return failure(parsed.error);
  const result = sharedDatabaseEnabled() ? await promoteSharedTrace(workspaceId, parsed.value) : promoteTraceToCase(workspaceId, parsed.value);
  if (!result.ok) return failure(promoteError(result.error));
  return success({ case: toRegressionCaseSummary(result.value) });
}

async function replayCase(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const caseId = stringValue(args.caseId);
  if (!caseId) return failure("caseId es obligatorio");
  const result = sharedDatabaseEnabled() ? await executeSharedRegressionCase(workspaceId, caseId) : await executeRegressionCase(workspaceId, caseId);
  return result.ok ? success(result.value) : failure(result.message);
}

async function runGate(workspaceId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseRegressionGateInput(args);
  if (!parsed.ok) return failure(parsed.error);
  if (sharedDatabaseEnabled()) {
    const queued = await enqueueGate(workspaceId, parsed.value);
    return queued.ok ? success(queued.value) : failure(queued.message);
  }
  const result = await runWorkspaceRegressionGate(workspaceId, parsed.value);
  return result.ok ? success(result.value) : failure(result.message);
}

function promoteError(error: "trace_not_found" | "trace_input_missing" | "trace_assertion_missing" | "case_exists"): string {
  return {
    trace_not_found: "trace not found",
    trace_input_missing: "trace input is required to replay a case",
    trace_assertion_missing: "trace assertion is required to create a case",
    case_exists: "trace is already a regression case",
  }[error];
}

interface ToolResult {
  content: [{ type: "text"; text: string }];
  structuredContent: unknown;
  isError?: boolean;
}

function success(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function failure(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}

function isPresetNumber(value: unknown, allowed: readonly number[]): value is number {
  return typeof value === "number" && allowed.includes(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
