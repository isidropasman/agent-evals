import { NextResponse } from "next/server";
import { executeRegressionCase } from "@/server/regression-runner";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { executeSharedRegressionCase } from "@/server/shared-regression-store";
import { subscriptionConnectionAvailable } from "@/server/subscription-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const { id } = await params;
  const subscriptionConnectionId = await optionalSubscriptionId(request);
  if (subscriptionConnectionId && !await subscriptionConnectionAvailable(principal.workspace.id, subscriptionConnectionId)) {
    return NextResponse.json({ error: "subscription unavailable" }, { status: 422 });
  }
  const result = sharedDatabaseEnabled() ? await executeSharedRegressionCase(principal.workspace.id, id, subscriptionConnectionId) : await executeRegressionCase(principal.workspace.id, id, subscriptionConnectionId);
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
