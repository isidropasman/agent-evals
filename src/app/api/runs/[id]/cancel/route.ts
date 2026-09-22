import { NextResponse } from "next/server";
import { getRun } from "@/server/db";
import { cancelRun } from "@/server/run-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedGetRun, sharedRequestRunCancellation } from "@/server/shared-store";
import { getSharedDefaultWorkspace } from "@/server/shared-workspace-store";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  const run = sharedDatabaseEnabled() ? await sharedGetRun(workspaceId, id) : getRun(id, workspaceId);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (run.status !== "running" && run.status !== "queued") {
    return NextResponse.json({ ok: false, error: "la corrida no está en ejecución" });
  }
  const aborted = cancelRun(id);
  const requested = sharedDatabaseEnabled() ? await sharedRequestRunCancellation(workspaceId, id) : false;
  return NextResponse.json({ ok: aborted || requested });
}
