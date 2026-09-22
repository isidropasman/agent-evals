import { randomUUID } from "node:crypto";
import {
  completeRegressionGateRun,
  getLatestCompletedRegressionGate,
  insertRegressionGateCaseResult,
  insertRegressionGateRun,
  listRegressionGateRuns,
  listRegressionGateCaseResults,
  type RegressionCaseStatus,
  type RegressionGateCaseResultRecord,
  type RegressionGateRunRecord,
  type RegressionGateStatus,
} from "./db";

export interface RegressionGateCaseResult {
  caseId: string;
  agentId: string;
  status: RegressionCaseStatus;
  passed: boolean | null;
  baselineStatus: RegressionCaseStatus | null;
  regression: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface RegressionGateReport {
  id: string;
  workspaceId: string;
  version: string;
  baselineVersion: string | null;
  status: Exclude<RegressionGateStatus, "running">;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  regressions: number;
  createdAt: number;
  completedAt: number;
  cases: RegressionGateCaseResult[];
}

export interface RegressionGateSummary {
  id: string;
  version: string;
  baselineVersion: string | null;
  status: Exclude<RegressionGateStatus, "running"> | "running";
  total: number;
  passed: number;
  failed: number;
  errors: number;
  regressions: number;
  createdAt: number;
  completedAt: number | null;
}

export function startRegressionGate(workspaceId: string, version: string): {
  run: RegressionGateRunRecord;
  baseline: RegressionGateRunRecord | null;
  baselineCases: Map<string, RegressionGateCaseResultRecord>;
} {
  const baseline = getLatestCompletedRegressionGate(workspaceId);
  const baselineCases = baseline
    ? new Map(listRegressionGateCaseResults(workspaceId, baseline.id).map((result) => [result.caseId, result]))
    : new Map<string, RegressionGateCaseResultRecord>();
  const run: RegressionGateRunRecord = {
    id: randomUUID(),
    workspaceId,
    version,
    baselineVersion: baseline?.version ?? null,
    status: "running",
    total: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    regressions: 0,
    createdAt: Date.now(),
    completedAt: null,
  };
  insertRegressionGateRun(run);
  return { run, baseline, baselineCases };
}

export function recordRegressionGateCase(
  workspaceId: string,
  gateRunId: string,
  result: RegressionGateCaseResult,
): void {
  insertRegressionGateCaseResult({
    gateRunId,
    workspaceId,
    ...result,
    createdAt: Date.now(),
  });
}

export function finishRegressionGate(
  workspaceId: string,
  run: RegressionGateRunRecord,
  input: Omit<RegressionGateReport, "id" | "workspaceId" | "version" | "baselineVersion" | "createdAt" | "completedAt" | "cases">,
  cases: RegressionGateCaseResult[],
): RegressionGateReport {
  const completedAt = Date.now();
  const completed = { ...input, completedAt };
  completeRegressionGateRun(workspaceId, run.id, completed);
  return {
    id: run.id,
    workspaceId,
    version: run.version,
    baselineVersion: run.baselineVersion,
    createdAt: run.createdAt,
    ...completed,
    cases,
  };
}

export function listRegressionGateSummaries(workspaceId: string): RegressionGateSummary[] {
  return listRegressionGateRuns(workspaceId).map(toSummary);
}

function toSummary(run: RegressionGateRunRecord): RegressionGateSummary {
  return {
    id: run.id,
    version: run.version,
    baselineVersion: run.baselineVersion,
    status: run.status,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    errors: run.errors,
    regressions: run.regressions,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}
