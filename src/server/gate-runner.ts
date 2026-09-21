import { executeRegressionCase } from "./regression-runner";
import { getRegressionCase, listRegressionCases, type RegressionCaseRecord } from "./db";
import {
  finishRegressionGate,
  recordRegressionGateCase,
  startRegressionGate,
  type RegressionGateCaseResult,
  type RegressionGateReport,
} from "./gate-store";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const MAX_CASES = 100;

export interface RegressionGateInput {
  caseIds?: string[];
  suiteId?: string;
  version?: string;
  concurrency?: number;
}

export type RunRegressionGateResult =
  | { ok: true; value: RegressionGateReport }
  | { ok: false; error: "no_cases" | "invalid_case_ids" | "too_many_cases"; message: string };

export async function runWorkspaceRegressionGate(
  workspaceId: string,
  input: RegressionGateInput = {},
): Promise<RunRegressionGateResult> {
  const allCases = listRegressionCases(workspaceId);
  const suiteCases = input.caseIds ? allCases : input.suiteId ? allCases.filter((item) => item.suiteId === input.suiteId) : allCases;
  const selected = selectCases(suiteCases, input.caseIds);
  if (!selected.ok) return selected;
  if (selected.value.length === 0) {
    return { ok: false, error: "no_cases", message: "workspace has no regression cases" };
  }
  if (selected.value.length > MAX_CASES) {
    return { ok: false, error: "too_many_cases", message: `a gate can run at most ${MAX_CASES} cases` };
  }

  const version = normalizeVersion(input.version) ?? process.env.GITHUB_SHA ?? `local-${Date.now()}`;
  const { run, baselineCases } = startRegressionGate(workspaceId, version);
  const results = await mapBounded(
    selected.value,
    Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(input.concurrency ?? DEFAULT_CONCURRENCY))),
    async (regressionCase) => replayAndClassify(workspaceId, regressionCase, baselineCases.get(regressionCase.id)?.status ?? null),
  );
  for (const result of results) recordRegressionGateCase(workspaceId, run.id, result);

  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const errors = results.filter((result) => result.status === "error").length;
  const regressions = results.filter((result) => result.regression).length;
  return {
    ok: true,
    value: finishRegressionGate(
      workspaceId,
      run,
      {
        status: errors > 0 ? "error" : failed > 0 ? "fail" : "pass",
        total: results.length,
        passed,
        failed,
        errors,
        regressions,
      },
      results,
    ),
  };
}

async function replayAndClassify(
  workspaceId: string,
  regressionCase: RegressionCaseRecord,
  baselineStatus: RegressionGateCaseResult["baselineStatus"],
): Promise<RegressionGateCaseResult> {
  try {
    const replay = await executeRegressionCase(workspaceId, regressionCase.id);
    if (replay.ok) {
      return {
        caseId: regressionCase.id,
        agentId: regressionCase.agentId,
        status: replay.value.replay.passed ? "pass" : "fail",
        passed: replay.value.replay.passed,
        baselineStatus,
        regression: baselineStatus === "pass" && !replay.value.replay.passed,
        latencyMs: replay.value.replay.latencyMs,
        error: null,
      };
    }
    return {
      caseId: regressionCase.id,
      agentId: regressionCase.agentId,
      status: "error",
      passed: null,
      baselineStatus,
      regression: baselineStatus === "pass",
      latencyMs: null,
      error: replay.message,
    };
  } catch (error: unknown) {
    return {
      caseId: regressionCase.id,
      agentId: regressionCase.agentId,
      status: "error",
      passed: null,
      baselineStatus,
      regression: baselineStatus === "pass",
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function selectCases(
  allCases: RegressionCaseRecord[],
  caseIds: string[] | undefined,
): { ok: true; value: RegressionCaseRecord[] } | { ok: false; error: "invalid_case_ids"; message: string } {
  if (!caseIds) return { ok: true, value: allCases };
  const byId = new Map(allCases.map((regressionCase) => [regressionCase.id, regressionCase]));
  const selected = caseIds.map((id) => byId.get(id));
  if (selected.some((regressionCase) => !regressionCase)) {
    return { ok: false, error: "invalid_case_ids", message: "one or more case IDs are not in this workspace" };
  }
  return { ok: true, value: selected.filter((regressionCase): regressionCase is RegressionCaseRecord => regressionCase !== undefined) };
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

function normalizeVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}
