import { NextResponse } from "next/server";
import { executeRegressionCase } from "@/server/regression-runner";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { executeSharedRegressionCase } from "@/server/shared-regression-store";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = sharedDatabaseEnabled() ? "workspace_local" : getDefaultWorkspace().id;
  const result = sharedDatabaseEnabled() ? await executeSharedRegressionCase(workspaceId, id) : await executeRegressionCase(workspaceId, id);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: replayStatus(result.error) });
  return NextResponse.json(result.value);
}

function replayStatus(error: string): number {
  if (error === "case_not_found" || error === "agent_not_found") return 404;
  if (error === "agent_not_runnable") return 409;
  if (error === "replay_not_persisted") return 500;
  return 502;
}
