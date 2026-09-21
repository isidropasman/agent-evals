import { randomUUID } from "node:crypto";
import { runRegressionReplay, type RegressionReplayResult } from "@/engine/replay";
import { defaultProviders } from "@/engine/runner";
import type { RegressionCaseRecord } from "./db";
import { toRegressionCaseSummary, type RegressionCaseSummary } from "./regression-store";
import { sharedGetAgent, sharedGetCase, sharedGetCaseBySource, sharedGetTrace, sharedInsertCase, sharedUpdateCaseReplay } from "./shared-store";
import { resolveKey } from "./keys";

export type SharedPromoteResult =
  | { ok: true; value: RegressionCaseRecord }
  | { ok: false; error: "trace_not_found" | "trace_input_missing" | "trace_assertion_missing" | "case_exists" };

export async function promoteSharedTrace(workspaceId: string, input: { agentId: string; traceId: string; name?: string }): Promise<SharedPromoteResult> {
  if (await sharedGetCaseBySource(workspaceId, input.agentId, input.traceId)) return { ok: false, error: "case_exists" };
  const trace = await sharedGetTrace(workspaceId, input.agentId, input.traceId);
  if (!trace) return { ok: false, error: "trace_not_found" };
  const inputText = typeof trace.input === "string" ? trace.input.trim() : trace.input == null ? "" : JSON.stringify(trace.input);
  if (!inputText) return { ok: false, error: "trace_input_missing" };
  if (!isAssertion(trace.assertion)) return { ok: false, error: "trace_assertion_missing" };
  const now = Date.now();
  const item: RegressionCaseRecord = { id: randomUUID(), workspaceId, agentId: input.agentId, sourceTraceId: input.traceId, suiteId: null, name: input.name?.trim() || trace.assertion.name, inputText, assertionName: trace.assertion.name.trim(), assertionDetail: trace.assertion.detail?.trim() || null, evaluator: null, expectedPass: true, lastStatus: null, lastPassed: null, lastLatencyMs: null, lastError: null, lastRunAt: null, createdAt: now, updatedAt: now };
  const inserted = await sharedInsertCase(item);
  return inserted.ok && inserted.value ? { ok: true, value: item } : { ok: false, error: "case_exists" };
}

export async function getSharedRegressionCase(workspaceId: string, id: string): Promise<RegressionCaseRecord | null> { return sharedGetCase(workspaceId, id); }
export async function listSharedRegressionCases(workspaceId: string): Promise<RegressionCaseSummary[]> {
  const { sharedListCases } = await import("./shared-store");
  return (await sharedListCases(workspaceId)).map(toRegressionCaseSummary);
}

export async function executeSharedRegressionCase(workspaceId: string, caseId: string): Promise<{ ok: true; value: { case: RegressionCaseSummary; replay: RegressionReplayResult } } | { ok: false; error: string; message: string }> {
  const regressionCase = await sharedGetCase(workspaceId, caseId);
  if (!regressionCase) return { ok: false, error: "case_not_found", message: "regression case not found" };
  const agent = await sharedGetAgent(regressionCase.agentId, workspaceId);
  if (!agent) return { ok: false, error: "agent_not_found", message: "agent not found" };
  if (!agent.active || !agent.endpointUrl) return { ok: false, error: "agent_not_runnable", message: "agent needs an active endpoint for replay" };
  const providers = defaultProviders(resolveKey("anthropic") ?? undefined, resolveKey("openai") ?? undefined);
  const replay = await runRegressionReplay({ connection: { endpointUrl: agent.endpointUrl, protocol: agent.protocol, authType: agent.authType, authToken: agent.authToken ?? undefined, authHeaderName: agent.authHeaderName ?? undefined }, sessionId: `regression-${caseId}-${randomUUID()}`, testCase: regressionCase }, providers.judge, providers.judgeModel);
  const runAt = Date.now();
  if (!replay.ok) {
    const message = `replay failed (${replay.error.kind})`;
    await sharedUpdateCaseReplay(workspaceId, caseId, { status: "error", passed: null, latencyMs: null, error: message, runAt });
    return { ok: false, error: "replay_failed", message };
  }
  await sharedUpdateCaseReplay(workspaceId, caseId, { status: replay.value.passed ? "pass" : "fail", passed: replay.value.passed, latencyMs: replay.value.latencyMs, error: null, runAt });
  const updated = await sharedGetCase(workspaceId, caseId);
  return { ok: true, value: { case: toRegressionCaseSummary(updated ?? regressionCase), replay: replay.value } };
}

function isAssertion(value: unknown): value is { name: string; detail?: string } { return typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string" && Boolean((value as { name: string }).name.trim()); }
