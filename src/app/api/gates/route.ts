import { NextResponse } from "next/server";
import { listRegressionGateSummaries } from "@/server/gate-store";
import { runWorkspaceRegressionGate } from "@/server/gate-runner";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { parseRegressionGateInput } from "@/server/http-input";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedListGates } from "@/server/shared-store";
import { enqueueGate } from "@/server/durable-gates";

export const runtime = "nodejs";

export async function GET() {
  const workspaceId = sharedDatabaseEnabled() ? "workspace_local" : getDefaultWorkspace().id;
  const gates = sharedDatabaseEnabled() ? await sharedListGates(workspaceId) : listRegressionGateSummaries(workspaceId);
  return NextResponse.json({ gates });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseRegressionGateInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (sharedDatabaseEnabled()) {
    const queued = await enqueueGate("workspace_local", parsed.value);
    if (!queued.ok) return NextResponse.json({ error: queued.message }, { status: queued.error === "no_cases" ? 409 : queued.error === "invalid_case_ids" ? 404 : 503 });
    return NextResponse.json(queued.value, { status: 202 });
  }
  const result = await runWorkspaceRegressionGate(getDefaultWorkspace().id, parsed.value);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.error === "no_cases" ? 409 : result.error === "too_many_cases" ? 413 : 404 });
  return NextResponse.json(result.value, { status: 201 });
}
