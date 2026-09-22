import { randomUUID } from "node:crypto";
import {
  getRegressionCase,
  getRegressionCaseBySource,
  getTrace,
  insertRegressionCase,
  listRegressionCases,
  updateRegressionCaseReplay,
  type RegressionCaseRecord,
  type RegressionCaseStatus,
} from "./db";

export interface PromoteTraceInput {
  agentId: string;
  traceId: string;
  name?: string;
}

export interface RegressionCaseSummary {
  id: string;
  workspaceId: string;
  agentId: string;
  sourceTraceId: string;
  name: string;
  assertionName: string;
  assertionDetail: string | null;
  expectedPass: boolean;
  lastStatus: RegressionCaseStatus | null;
  lastPassed: boolean | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type PromoteTraceResult =
  | { ok: true; value: RegressionCaseRecord }
  | {
      ok: false;
      error: "trace_not_found" | "trace_input_missing" | "trace_assertion_missing" | "case_exists";
    };

export function promoteTraceToCase(
  workspaceId: string,
  input: PromoteTraceInput,
): PromoteTraceResult {
  const existing = getRegressionCaseBySource(workspaceId, input.agentId, input.traceId);
  if (existing) return { ok: false, error: "case_exists" };

  const trace = getTrace(workspaceId, input.agentId, input.traceId);
  if (!trace) return { ok: false, error: "trace_not_found" };
  const inputText = payloadToText(trace.input);
  if (!inputText) return { ok: false, error: "trace_input_missing" };
  if (!isAssertion(trace.assertion)) return { ok: false, error: "trace_assertion_missing" };

  const now = Date.now();
  const regressionCase: RegressionCaseRecord = {
    id: randomUUID(),
    workspaceId,
    agentId: input.agentId,
    sourceTraceId: input.traceId,
    suiteId: null,
    name: input.name?.trim() || trace.assertion.name,
    inputText,
    assertionName: trace.assertion.name.trim(),
    assertionDetail: trace.assertion.detail?.trim() || null,
    evaluator: null,
    expectedPass: true,
    lastStatus: null,
    lastPassed: null,
    lastLatencyMs: null,
    lastError: null,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
  if (!insertRegressionCase(regressionCase)) return { ok: false, error: "case_exists" };
  return { ok: true, value: regressionCase };
}

export function getWorkspaceRegressionCase(
  workspaceId: string,
  id: string,
): RegressionCaseRecord | null {
  return getRegressionCase(workspaceId, id);
}

export function getWorkspaceRegressionCases(workspaceId: string): RegressionCaseSummary[] {
  return listRegressionCases(workspaceId).map(toSummary);
}

export function saveRegressionReplay(
  workspaceId: string,
  id: string,
  input: {
    status: RegressionCaseStatus;
    passed: boolean | null;
    latencyMs: number | null;
    error: string | null;
    runAt: number;
  },
): boolean {
  return updateRegressionCaseReplay(workspaceId, id, input);
}

export function toRegressionCaseSummary(input: RegressionCaseRecord): RegressionCaseSummary {
  return toSummary(input);
}

function toSummary(input: RegressionCaseRecord): RegressionCaseSummary {
  const { inputText: _inputText, ...summary } = input;
  return summary;
}

function payloadToText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  return serialized?.trim() || null;
}

function isAssertion(value: unknown): value is { name: string; detail?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    Boolean((value as { name: string }).name.trim())
  );
}
