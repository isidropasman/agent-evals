import { randomUUID } from "node:crypto";
import { runRegressionReplay, type RegressionReplayResult } from "@/engine/replay";
import { defaultProviders } from "@/engine/runner";
import { getAgent } from "./db";
import { resolveKey } from "./keys";
import {
  getWorkspaceRegressionCase,
  saveRegressionReplay,
  toRegressionCaseSummary,
  type RegressionCaseSummary,
} from "./regression-store";

export type ExecuteRegressionResult =
  | { ok: true; value: { case: RegressionCaseSummary; replay: RegressionReplayResult } }
  | {
      ok: false;
      error:
        | "case_not_found"
        | "agent_not_found"
        | "agent_not_runnable"
        | "replay_failed"
        | "replay_not_persisted";
      message: string;
    };

export async function executeRegressionCase(
  workspaceId: string,
  caseId: string,
): Promise<ExecuteRegressionResult> {
  const regressionCase = getWorkspaceRegressionCase(workspaceId, caseId);
  if (!regressionCase) {
    return { ok: false, error: "case_not_found", message: "regression case not found" };
  }
  const agent = getAgent(regressionCase.agentId, workspaceId);
  if (!agent) {
    return { ok: false, error: "agent_not_found", message: "agent not found" };
  }
  if (!agent.active || !agent.endpointUrl) {
    return {
      ok: false,
      error: "agent_not_runnable",
      message: "agent needs an active endpoint for replay",
    };
  }

  const providers = defaultProviders(
    resolveKey("anthropic") ?? undefined,
    resolveKey("openai") ?? undefined,
  );
  const replay = await runRegressionReplay(
    {
      connection: {
        endpointUrl: agent.endpointUrl,
        protocol: agent.protocol,
        authType: agent.authType,
        authToken: agent.authToken ?? undefined,
        authHeaderName: agent.authHeaderName ?? undefined,
      },
      sessionId: `regression-${regressionCase.id}-${randomUUID()}`,
      testCase: regressionCase,
    },
    providers.judge,
    providers.judgeModel,
  );
  const runAt = Date.now();
  if (!replay.ok) {
    const message = replayErrorMessage(replay.error.kind);
    saveRegressionReplay(workspaceId, caseId, {
      status: "error",
      passed: null,
      latencyMs: null,
      error: message,
      runAt,
    });
    return {
      ok: false,
      error: "replay_failed",
      message,
    };
  }
  const persisted = saveRegressionReplay(workspaceId, caseId, {
    status: replay.value.passed ? "pass" : "fail",
    passed: replay.value.passed,
    latencyMs: replay.value.latencyMs,
    error: null,
    runAt,
  });
  if (!persisted) {
    return { ok: false, error: "replay_not_persisted", message: "replay result could not be persisted" };
  }
  const updated = getWorkspaceRegressionCase(workspaceId, caseId);
  return {
    ok: true,
    value: { case: toRegressionCaseSummary(updated ?? regressionCase), replay: replay.value },
  };
}

function replayErrorMessage(kind: string): string {
  return `replay failed (${kind})`;
}
