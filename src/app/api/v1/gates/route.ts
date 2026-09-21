import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedListGates } from "@/server/shared-store";
import { enqueueGate } from "@/server/durable-gates";
import { recordAudit } from "@/server/audit";
import { parseRegressionGateInput } from "@/server/http-input";
import { listRegressionGateSummaries } from "@/server/gate-store";
import { runWorkspaceRegressionGate } from "@/server/gate-runner";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const gates = sharedDatabaseEnabled() ? (await sharedListGates(principal.workspace.id)).map((gate) => ({ id: gate.id, version: gate.version, baselineVersion: gate.baselineVersion, status: gate.status, total: gate.total, passed: gate.passed, failed: gate.failed, errors: gate.errors, regressions: gate.regressions, createdAt: gate.createdAt, completedAt: gate.completedAt })) : listRegressionGateSummaries(principal.workspace.id);
  return NextResponse.json({ gates });
}

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseRegressionGateInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const asyncRequested = isRecord(body) && (body.mode === "async" || request.headers.get("prefer")?.includes("respond-async"));
  if (asyncRequested) {
    const queued = await enqueueGate(principal.workspace.id, parsed.value);
    if (!queued.ok) return NextResponse.json({ error: queued.message }, { status: queued.error === "no_cases" ? 409 : queued.error === "invalid_case_ids" ? 404 : 503 });
    await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "gate.queued", "gate", queued.value.gateRunId, { jobId: queued.value.jobId });
    return NextResponse.json(queued.value, { status: 202, headers: { location: `/api/v1/gates/${queued.value.gateRunId}` } });
  }
  if (sharedDatabaseEnabled()) {
    const queued = await enqueueGate(principal.workspace.id, parsed.value);
    if (!queued.ok) return NextResponse.json({ error: queued.message }, { status: queued.error === "no_cases" ? 409 : queued.error === "invalid_case_ids" ? 404 : 503 });
    await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "gate.queued", "gate", queued.value.gateRunId, { jobId: queued.value.jobId });
    return NextResponse.json(queued.value, { status: 202, headers: { location: `/api/v1/gates/${queued.value.gateRunId}` } });
  }
  const result = await runWorkspaceRegressionGate(principal.workspace.id, parsed.value);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.error === "no_cases" ? 409 : result.error === "too_many_cases" ? 413 : 404 });
  return NextResponse.json(result.value, { status: 201 });
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
