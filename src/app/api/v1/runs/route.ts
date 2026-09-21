import { NextResponse } from "next/server";
import { listRuns } from "@/server/db";
import { principalFromRequest } from "@/server/auth";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedListRuns } from "@/server/shared-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim();
  const runs = (sharedDatabaseEnabled() ? await sharedListRuns(principal.workspace.id) : listRuns(principal.workspace.id))
    .filter((run) => !agentId || run.agentId === agentId)
    .map((run) => ({
      id: run.id,
      agentId: run.agentId,
      agentName: run.agentName,
      clientName: run.clientName,
      status: run.status,
      progress: run.progress,
      score: run.report?.score ?? null,
      certified: run.report?.certified ?? null,
      suite: run.report?.suite ?? null,
      error: run.error,
      createdAt: run.createdAt,
    }));
  return NextResponse.json({ runs });
}
