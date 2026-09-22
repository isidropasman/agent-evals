import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { connectCodexSubscription } from "@/server/codex-subscription";
import type { CodexBridgeError } from "@/server/codex-app-server";

export const runtime = "nodejs";
type ConnectCodexError = CodexBridgeError | "subscription_not_saved";

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "admin")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const result = await connectCodexSubscription(principal.workspace.id);
  if (result.ok) return NextResponse.json({ connection: result.value });
  return NextResponse.json({ error: publicError(result.error) }, { status: errorStatus(result.error) });
}

function errorStatus(error: ConnectCodexError): number {
  return error === "subscription_not_saved" ? 500 : error.kind === "not_authenticated" || error.kind === "unsupported_auth" ? 409 : 503;
}

function publicError(error: ConnectCodexError): string {
  if (error === "subscription_not_saved") return "Codex no pudo guardarse";
  return error.message;
}
