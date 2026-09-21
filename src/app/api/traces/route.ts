import { NextResponse } from "next/server";
import { listAgents } from "@/server/db";
import { getWorkspaceTraces } from "@/server/trace-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { getSharedTraces } from "@/server/shared-trace-store";
import { sharedListAgents } from "@/server/shared-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const workspaceId = sharedDatabaseEnabled() ? "workspace_local" : getDefaultWorkspace().id;
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 12 : Number(rawLimit);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "limit debe estar entre 1 y 100" }, { status: 400 });
  }
  const names = new Map((sharedDatabaseEnabled() ? await sharedListAgents(workspaceId) : listAgents(workspaceId)).map((agent) => [agent.id, agent.name]));
  const traces = (sharedDatabaseEnabled() ? await getSharedTraces(workspaceId, limit) : getWorkspaceTraces(workspaceId, limit)).map((trace) => ({
    ...trace,
    agentName: names.get(trace.agentId) ?? "agent eliminado",
  }));
  return NextResponse.json({ traces });
}
