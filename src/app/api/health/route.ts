import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Lightweight config check for the UI to show whether the engine can run. */
export function GET() {
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const allowLocalAgents =
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS === "1" ||
    process.env.NODE_ENV !== "production";
  return NextResponse.json({ anthropicConfigured, allowLocalAgents });
}
