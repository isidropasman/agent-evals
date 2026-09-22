import { NextResponse } from "next/server";
import { listSubscriptionConnections, listUsage } from "@/server/subscription-store";
import { subscriptionWorkspaceId } from "@/server/subscription-workspace";
import { codexProviderStatus } from "@/server/codex-subscription";

export const runtime = "nodejs";

export async function GET() {
  const workspaceId = await subscriptionWorkspaceId();
  const codexStatus = await codexProviderStatus();
  return NextResponse.json({
    connections: await listSubscriptionConnections(workspaceId),
    usage: await listUsage(workspaceId),
    providers: [
      { id: "github_copilot", status: "available" },
      { id: "codex", status: codexStatus },
      { id: "supergrok", status: "unavailable" },
    ],
  });
}
