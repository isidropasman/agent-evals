import { randomUUID } from "node:crypto";
import { Inngest } from "inngest";
import type { RegressionGateInput } from "./gate-runner";
import { sharedDatabaseEnabled, queryShared } from "./shared-db";
import { sharedCompleteGate, sharedListCasesResult, sharedStartGate } from "./shared-store";

export const inngest = new Inngest({ id: "gauntlet" });

export type EnqueueGateResult =
  | { ok: true; value: { jobId: string; gateRunId: string; status: "queued" } }
  | { ok: false; error: "shared_database_required" | "no_cases" | "invalid_case_ids" | "queue_unavailable"; message: string };

export async function enqueueGate(workspaceId: string, input: RegressionGateInput): Promise<EnqueueGateResult> {
  if (!sharedDatabaseEnabled()) return { ok: false, error: "shared_database_required", message: "async gates require DATABASE_URL" };
  if (!queueConfigured()) return { ok: false, error: "queue_unavailable", message: "durable queue unavailable" };
  const casesResult = await sharedListCasesResult(workspaceId);
  if (!casesResult.ok) return { ok: false, error: "queue_unavailable", message: "durable queue unavailable" };
  const cases = casesResult.value;
  const selected = input.caseIds ? cases.filter((item) => input.caseIds?.includes(item.id)) : input.suiteId ? cases.filter((item) => item.suiteId === input.suiteId) : cases;
  if (input.caseIds && selected.length !== new Set(input.caseIds).size) return { ok: false, error: "invalid_case_ids", message: "one or more case IDs do not belong to the workspace" };
  if (selected.length === 0) return { ok: false, error: "no_cases", message: "workspace has no regression cases" };
  const version = input.version?.trim() || process.env.GITHUB_SHA || `local-${Date.now()}`;
  const started = await sharedStartGate(workspaceId, version);
  if (!started.ok) return { ok: false, error: "queue_unavailable", message: "durable queue unavailable" };
  const jobId = randomUUID();
  const now = Date.now();
  const job = await queryShared(
    `INSERT INTO gate_jobs (id, workspace_id, gate_run_id, status, available_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'queued', $4, $4, $4)`,
    [jobId, workspaceId, started.value.run.id, now],
  );
  if (!job.ok) {
    await failGate(workspaceId, started.value.run.id);
    return { ok: false, error: "queue_unavailable", message: "durable queue unavailable" };
  }
  try {
    await inngest.send({ name: "gauntlet/gate.requested", data: { workspaceId, gateRunId: started.value.run.id, jobId, input } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await queryShared("UPDATE gate_jobs SET status = 'error', last_error = $1, updated_at = $2 WHERE id = $3", [message, Date.now(), jobId]);
    await failGate(workspaceId, started.value.run.id);
    return { ok: false, error: "queue_unavailable", message: "durable queue rejected the gate" };
  }
  return { ok: true, value: { jobId, gateRunId: started.value.run.id, status: "queued" } };
}

function queueConfigured(): boolean {
  const localDev = process.env.NODE_ENV !== "production" && process.env.INNGEST_DEV === "1";
  return localDev || Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
}

async function failGate(workspaceId: string, gateRunId: string): Promise<void> {
  await sharedCompleteGate(workspaceId, gateRunId, { status: "error", total: 0, passed: 0, failed: 0, errors: 0, regressions: 0, completedAt: Date.now() });
}
