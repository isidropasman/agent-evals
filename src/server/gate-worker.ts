import { inngest } from "./durable-gates";
import { defaultProviders } from "@/engine/runner";
import { runRegressionReplay } from "@/engine/replay";
import { randomUUID } from "node:crypto";
import type { RegressionGateCaseResultRecord } from "./db";
import { resolveKey } from "./keys";
import { sharedCompleteGate, sharedGetAgent, sharedGetGate, sharedGetPreviousCompletedGate, sharedInsertGateCaseResult, sharedListCasesResult, sharedListGateCaseResultsResult, sharedUpdateCaseReplay } from "./shared-store";
import { getSharedSuite } from "./shared-suite-store";
import type { RegressionGateInput } from "./gate-runner";
import type { RegressionGateRunRecord } from "./db";

interface GateEventData {
  workspaceId: string;
  gateRunId: string;
  jobId: string;
  input: RegressionGateInput;
}

interface GateWorkerResult {
  caseId: string;
  agentId: string;
  status: "pass" | "fail" | "error";
  passed: boolean | null;
  baselineStatus: "pass" | "fail" | "error" | null;
  regression: boolean;
  latencyMs: number | null;
  error: string | null;
}

export const gateWorker = inngest.createFunction(
  {
    id: "gauntlet-gate-worker",
    retries: 3,
    concurrency: 5,
    triggers: [{ event: "gauntlet/gate.requested" }],
    onFailure: async ({ event }) => {
      const input = gateFailureInput(event);
      if (input) await finalizeExhaustedGate(input);
    },
  },
  async ({ event }: { event: { data: GateEventData } }) => {
    const { workspaceId, gateRunId, jobId } = event.data;
    const gate = await sharedGetGate(workspaceId, gateRunId);
    if (!gate) {
      await markJob(jobId, "error", "gate not found");
      return { status: "gate-not-found" };
    }
    if (gate.status !== "running") {
      await markJob(jobId, "done", null);
      return { status: "already-complete" };
    }
    await markJob(jobId, "running", null);
    const baseline = await previousBaseline(workspaceId, gateRunId);
    const casesResult = await sharedListCasesResult(workspaceId);
    if (!casesResult.ok) throw new Error("gate cases unavailable");
    const cases = casesResult.value;
    const results: GateWorkerResult[] = [];
    const caseIds = event.data.input.caseIds;
    const suite = event.data.input.suiteId ? await getSharedSuite(workspaceId, event.data.input.suiteId) : null;
    const selected = orderCases(
      caseIds ? caseIds.map((id) => cases.find((item) => item.id === id)).filter((item): item is (typeof cases)[number] => item !== undefined) : event.data.input.suiteId ? cases.filter((item) => item.suiteId === event.data.input.suiteId) : cases,
    ).slice(0, suite?.maxCases ?? 100);
    const persistedResult = await sharedListGateCaseResultsResult(workspaceId, gateRunId);
    if (!persistedResult.ok) throw new Error("gate results unavailable");
    const persisted = persistedResult.value;
    const persistedByCase = new Map(persisted.map((result) => [result.caseId, result]));
    results.push(...selected.flatMap((item) => {
      const result = persistedByCase.get(item.id);
      return result ? [toWorkerResult(result)] : [];
    }));
    const pending = selected.filter((item) => !persistedByCase.has(item.id));
    const replayed = await mapBounded(pending, boundedConcurrency(event.data.input.concurrency ?? suite?.concurrency ?? undefined), async (item): Promise<GateWorkerResult> => {
      const agent = await sharedGetAgent(item.agentId, workspaceId);
      const baselineStatus = baseline.get(item.id)?.status ?? null;
      if (!agent || !agent.active || !agent.endpointUrl) {
        return { caseId: item.id, agentId: item.agentId, status: "error" as const, passed: null, baselineStatus, regression: baselineStatus === "pass", latencyMs: null, error: "agent needs an active endpoint for replay" };
      }
      const providers = defaultProviders(resolveKey("anthropic") ?? undefined, resolveKey("openai") ?? undefined);
      const replay = await runRegressionReplay({ connection: { endpointUrl: agent.endpointUrl, protocol: agent.protocol, authType: agent.authType, authToken: agent.authToken ?? undefined, authHeaderName: agent.authHeaderName ?? undefined }, sessionId: `regression-${item.id}-${randomUUID()}`, testCase: item }, providers.judge, providers.judgeModel);
      const now = Date.now();
      if (!replay.ok) {
        const message = `replay failed (${replay.error.kind})`;
        if (!await sharedUpdateCaseReplay(workspaceId, item.id, { status: "error", passed: null, latencyMs: null, error: message, runAt: now })) throw new Error("replay result persistence failed");
        return { caseId: item.id, agentId: item.agentId, status: "error" as const, passed: null, baselineStatus, regression: baselineStatus === "pass", latencyMs: null, error: message };
      }
      const status: GateWorkerResult["status"] = replay.value.passed ? "pass" : "fail";
      if (!await sharedUpdateCaseReplay(workspaceId, item.id, { status, passed: replay.value.passed, latencyMs: replay.value.latencyMs, error: null, runAt: now })) throw new Error("replay result persistence failed");
      return { caseId: item.id, agentId: item.agentId, status, passed: replay.value.passed, baselineStatus, regression: baselineStatus === "pass" && !replay.value.passed, latencyMs: replay.value.latencyMs, error: null };
    });
    results.push(...replayed);
    for (const result of results) {
      const inserted = await sharedInsertGateCaseResult({ gateRunId, workspaceId, ...result, createdAt: Date.now() });
      if (!inserted.ok) throw new Error("gate result persistence failed");
    }
    const errors = results.filter((item) => item.status === "error").length;
    const failed = results.filter((item) => item.status === "fail").length;
    if (!await sharedCompleteGate(workspaceId, gateRunId, { status: errors > 0 ? "error" : failed > 0 ? "fail" : "pass", total: results.length, passed: results.length - errors - failed, failed, errors, regressions: results.filter((item) => item.regression).length, completedAt: Date.now() })) throw new Error("gate completion persistence failed");
    await markJob(jobId, "done", null);
    return { status: "completed", gateRunId };
  },
);

interface GateFailureInput {
  workspaceId: string;
  gateRunId: string;
  jobId: string;
}

async function finalizeExhaustedGate(input: GateFailureInput): Promise<void> {
  await markJob(input.jobId, "error", "gate worker exhausted retries");
  const gate = await sharedGetGate(input.workspaceId, input.gateRunId);
  if (!gate || gate.status !== "running") return;
  const counts = exhaustedGateCounts(gate);
  await sharedCompleteGate(input.workspaceId, input.gateRunId, {
    ...counts,
    status: "error",
    regressions: gate.regressions,
    completedAt: Date.now(),
  });
}

export function exhaustedGateCounts(gate: Pick<RegressionGateRunRecord, "total" | "passed" | "failed" | "errors">): Pick<RegressionGateRunRecord, "total" | "passed" | "failed" | "errors"> {
  const accounted = gate.passed + gate.failed + gate.errors;
  const total = Math.max(gate.total, accounted + 1);
  return {
    total,
    passed: gate.passed,
    failed: gate.failed,
    errors: total - gate.passed - gate.failed,
  };
}

async function previousBaseline(workspaceId: string, gateRunId: string): Promise<Map<string, { status: "pass" | "fail" | "error" }>> {
  const gate = await sharedGetGate(workspaceId, gateRunId);
  if (!gate?.baselineVersion) return new Map();
  const previous = await sharedGetPreviousCompletedGate(workspaceId, gate.createdAt);
  if (!previous) return new Map();
  const results = await sharedListGateCaseResultsResult(workspaceId, previous.id);
  if (!results.ok) throw new Error("gate baseline unavailable");
  return new Map(results.value.map((item) => [item.caseId, { status: item.status }]));
}

async function markJob(jobId: string, status: string, error: string | null): Promise<void> {
  await import("./shared-db").then(({ queryShared }) => queryShared("UPDATE gate_jobs SET status = $1, attempts = attempts + 1, last_error = $2, updated_at = $3 WHERE id = $4", [status, error, Date.now(), jobId]));
}

function boundedConcurrency(value: number | undefined): number {
  return Math.min(8, Math.max(1, Math.floor(value ?? 4)));
}

function toWorkerResult(result: RegressionGateCaseResultRecord): GateWorkerResult {
  return {
    caseId: result.caseId,
    agentId: result.agentId,
    status: result.status,
    passed: result.passed,
    baselineStatus: result.baselineStatus,
    regression: result.regression,
    latencyMs: result.latencyMs,
    error: result.error,
  };
}

function orderCases<T extends { id: string; sourceTraceId: string; createdAt: number }>(cases: T[]): T[] {
  return [...cases].sort((left, right) => {
    const leftPosition = datasetPosition(left.sourceTraceId);
    const rightPosition = datasetPosition(right.sourceTraceId);
    if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) return leftPosition - rightPosition;
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.id.localeCompare(right.id);
  });
}

function datasetPosition(sourceTraceId: string): number | null {
  const match = /^dataset:[^:]+:(\d+)$/.exec(sourceTraceId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function gateFailureInput(value: unknown): GateFailureInput | null {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.event) || !isRecord(value.data.event.data)) return null;
  const data = value.data.event.data;
  if (typeof data.workspaceId !== "string" || typeof data.gateRunId !== "string" || typeof data.jobId !== "string") return null;
  return { workspaceId: data.workspaceId, gateRunId: data.gateRunId, jobId: data.jobId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function mapBounded<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  });
  await Promise.all(workers);
  return results;
}
