import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { listSubscriptionConnections, listUsage } from "@/server/subscription-store";
import { codexProviderStatus } from "@/server/codex-subscription";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const codexStatus = await codexProviderStatus();
  return NextResponse.json({
    connections: await listSubscriptionConnections(principal.workspace.id),
    usage: await listUsage(principal.workspace.id),
    providers: [
      { id: "github_copilot", status: "available" },
      { id: "codex", status: codexStatus },
      { id: "supergrok", status: "unavailable" },
    ],
  });
}
