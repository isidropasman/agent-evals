import { NextResponse } from "next/server";
import { connectCodexSubscription } from "@/server/codex-subscription";
import { subscriptionWorkspaceId } from "@/server/subscription-workspace";
import type { CodexBridgeError } from "@/server/codex-app-server";

export const runtime = "nodejs";
type ConnectCodexError = CodexBridgeError | "subscription_not_saved";

export async function POST() {
  const result = await connectCodexSubscription(await subscriptionWorkspaceId());
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
