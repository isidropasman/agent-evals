import { NextResponse } from "next/server";
import { getRun } from "@/server/db";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedGetRun } from "@/server/shared-store";
import { getSharedDefaultWorkspace } from "@/server/shared-workspace-store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  const run = sharedDatabaseEnabled() ? await sharedGetRun(workspaceId, id) : getRun(id, workspaceId);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: run.id,
    agentId: run.agentId,
    agentName: run.agentName,
    clientName: run.clientName,
    status: run.status,
    progress: run.progress,
    report: run.report,
    error: run.error,
    createdAt: run.createdAt,
  });
}
