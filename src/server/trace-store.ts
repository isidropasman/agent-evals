import {
  getAgent,
  getTrace,
  getTraceStats,
  insertTrace,
  listTraces,
  listWorkspaceTraces,
  type TraceRecord,
  type TraceStatsRecord,
} from "./db";
import { redactTracePayload } from "./trace-normalizer";

export type TraceKind = "run" | "turn" | "tool_call" | "tool_result" | "assertion";
export type TraceStatus = "ok" | "error";

export interface TraceEnvelope {
  traceId: string;
  eventId: string;
  agentId: string;
  deployment?: string;
  version?: string;
  parentId?: string;
  kind: TraceKind;
  input?: unknown;
  output?: unknown;
  toolName?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  latencyMs?: number;
  status?: TraceStatus;
  assertion?: {
    name: string;
    passed: boolean;
    detail?: string;
  };
  occurredAt: number;
  metadata?: Record<string, string>;
}

export interface TraceSummary {
  traceId: string;
  eventId: string;
  agentId: string;
  deployment: string | null;
  version: string | null;
  kind: TraceKind;
  toolName: string | null;
  latencyMs: number | null;
  status: TraceStatus | null;
  assertion: TraceEnvelope["assertion"] | null;
  occurredAt: number;
  metadata: Record<string, string> | null;
}

export type IngestTraceResult =
  | { ok: true; value: { inserted: boolean; traceId: string } }
  | { ok: false; error: "agent_not_found" | "agent_workspace_mismatch" | "storage_unavailable" };

export function ingestTrace(workspaceId: string, envelope: TraceEnvelope): IngestTraceResult {
  const agent = getAgent(envelope.agentId);
  if (!agent) return { ok: false, error: "agent_not_found" };
  if (agent.workspaceId !== workspaceId) return { ok: false, error: "agent_workspace_mismatch" };
  const record: TraceRecord = {
    workspaceId,
    eventId: envelope.eventId,
    traceId: envelope.traceId,
    agentId: envelope.agentId,
    deployment: envelope.deployment ?? null,
    version: envelope.version ?? null,
    parentId: envelope.parentId ?? null,
    kind: envelope.kind,
    input: redactTracePayload(envelope.input),
    output: redactTracePayload(envelope.output),
    toolName: envelope.toolName ?? null,
    toolArguments: redactTracePayload(envelope.toolArguments),
    toolResult: redactTracePayload(envelope.toolResult),
    latencyMs: envelope.latencyMs ?? null,
    status: envelope.status ?? null,
    assertion: envelope.assertion ? redactTracePayload(envelope.assertion) : null,
    occurredAt: envelope.occurredAt,
    metadata: envelope.metadata ?? null,
  };
  return {
    ok: true,
    value: { inserted: insertTrace(record), traceId: envelope.traceId },
  };
}

export function getAgentTraces(workspaceId: string, agentId: string, limit = 20): TraceSummary[] {
  return listTraces(workspaceId, agentId, clampLimit(limit)).map(toSummary);
}

export function getAgentTrace(
  workspaceId: string,
  agentId: string,
  traceId: string,
): TraceSummary | null {
  const trace = getTrace(workspaceId, agentId, traceId);
  return trace ? toSummary(trace) : null;
}

export function getWorkspaceTraceStats(workspaceId: string, now = Date.now()): TraceStatsRecord {
  return getTraceStats(workspaceId, now);
}

export function getWorkspaceTraces(
  workspaceId: string,
  limit = 50,
  agentId?: string,
): TraceSummary[] {
  return listWorkspaceTraces(workspaceId, clampLimit(limit), agentId).map(toSummary);
}

function toSummary(trace: TraceRecord): TraceSummary {
  return {
    traceId: trace.traceId,
    eventId: trace.eventId,
    agentId: trace.agentId,
    deployment: trace.deployment,
    version: trace.version,
    kind: trace.kind as TraceKind,
    toolName: trace.toolName,
    latencyMs: trace.latencyMs,
    status: trace.status as TraceStatus | null,
    assertion: trace.assertion as TraceSummary["assertion"],
    occurredAt: trace.occurredAt,
    metadata: trace.metadata,
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.min(100, Math.max(1, Math.floor(limit)));
}
