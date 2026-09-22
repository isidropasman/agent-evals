import { sharedGetAgent, sharedGetTrace, sharedInsertTrace, sharedListTraces, sharedTraceStats } from "./shared-store";
import type { TraceEnvelope, TraceSummary, IngestTraceResult } from "./trace-store";
import { redactTracePayload } from "./trace-normalizer";

export async function ingestSharedTrace(workspaceId: string, envelope: TraceEnvelope): Promise<IngestTraceResult> {
  const agent = await sharedGetAgent(envelope.agentId);
  if (!agent) return { ok: false, error: "agent_not_found" };
  if (agent.workspaceId !== workspaceId) return { ok: false, error: "agent_workspace_mismatch" };
  const result = await sharedInsertTrace({
    workspaceId, eventId: envelope.eventId, traceId: envelope.traceId, agentId: envelope.agentId,
    deployment: envelope.deployment ?? null, version: envelope.version ?? null, parentId: envelope.parentId ?? null,
    kind: envelope.kind, input: redactTracePayload(envelope.input), output: redactTracePayload(envelope.output), toolName: envelope.toolName ?? null,
    toolArguments: redactTracePayload(envelope.toolArguments), toolResult: redactTracePayload(envelope.toolResult), latencyMs: envelope.latencyMs ?? null,
    status: envelope.status ?? null, assertion: envelope.assertion ? redactTracePayload(envelope.assertion) : null,
    occurredAt: envelope.occurredAt, metadata: envelope.metadata ?? null,
  });
  return result.ok ? { ok: true, value: { inserted: result.value, traceId: envelope.traceId } } : { ok: false, error: "storage_unavailable" };
}

export async function getSharedTraces(workspaceId: string, limit: number, agentId?: string): Promise<TraceSummary[]> {
  return (await sharedListTraces(workspaceId, limit, agentId)).map(summary);
}

export async function getSharedTrace(workspaceId: string, agentId: string, traceId: string): Promise<TraceSummary | null> {
  const trace = await sharedGetTrace(workspaceId, agentId, traceId);
  return trace ? summary(trace) : null;
}

export async function getSharedTraceStats(workspaceId: string): Promise<Awaited<ReturnType<typeof sharedTraceStats>>> {
  return sharedTraceStats(workspaceId);
}

function summary(trace: Awaited<ReturnType<typeof sharedGetTrace>> & object): TraceSummary {
  return { traceId: trace.traceId, eventId: trace.eventId, agentId: trace.agentId, deployment: trace.deployment, version: trace.version, kind: trace.kind as TraceSummary["kind"], toolName: trace.toolName, latencyMs: trace.latencyMs, status: trace.status as TraceSummary["status"], assertion: trace.assertion as TraceSummary["assertion"], occurredAt: trace.occurredAt, metadata: trace.metadata };
}
