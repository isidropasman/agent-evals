import { NextResponse } from "next/server";
import { keyStatus } from "@/server/keys";

export const runtime = "nodejs";

/** Lightweight config check for the UI to show whether the engine can run. */
export function GET() {
  const anthropic = keyStatus("anthropic");
  const openai = keyStatus("openai");
  const allowLocalAgents =
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS === "1" ||
    process.env.NODE_ENV !== "production";
  return NextResponse.json({
    anthropicConfigured: anthropic.configured,
    keys: { anthropic, openai },
    allowLocalAgents,
  });
}
