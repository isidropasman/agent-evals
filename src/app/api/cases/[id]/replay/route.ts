import { NextResponse } from "next/server";
import { executeRegressionCase } from "@/server/regression-runner";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { executeSharedRegressionCase } from "@/server/shared-regression-store";
import { subscriptionConnectionAvailable } from "@/server/subscription-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const subscriptionConnectionId = await optionalSubscriptionId(request);
  const workspaceId = sharedDatabaseEnabled() ? "workspace_local" : getDefaultWorkspace().id;
  if (subscriptionConnectionId && !await subscriptionConnectionAvailable(workspaceId, subscriptionConnectionId)) {
    return NextResponse.json({ error: "subscription unavailable" }, { status: 422 });
  }
  const result = sharedDatabaseEnabled() ? await executeSharedRegressionCase(workspaceId, id, subscriptionConnectionId) : await executeRegressionCase(workspaceId, id, subscriptionConnectionId);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: replayStatus(result.error) });
  return NextResponse.json(result.value);
}

async function optionalSubscriptionId(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as { subscriptionConnectionId?: unknown }).subscriptionConnectionId === "string") {
      const value = (body as { subscriptionConnectionId: string }).subscriptionConnectionId.trim();
      return value || undefined;
    }
  } catch {}
  return undefined;
}

function replayStatus(error: string): number {
  if (error === "case_not_found" || error === "agent_not_found") return 404;
  if (error === "agent_not_runnable") return 409;
  if (error === "replay_not_persisted") return 500;
  return 502;
}
