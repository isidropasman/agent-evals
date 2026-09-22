import { NextResponse } from "next/server";
import { keyStatus } from "@/server/keys";
import { sharedDatabaseEnabled, queryShared } from "@/server/shared-db";
import { secretsConfigured } from "@/server/secrets";

export const runtime = "nodejs";

/** Lightweight config check for the UI to show whether the engine can run. */
export async function GET(request: Request) {
  const anthropic = keyStatus("anthropic");
  const openai = keyStatus("openai");
  const allowLocalAgents =
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS === "1" ||
    process.env.NODE_ENV !== "production";
  const database = sharedDatabaseEnabled() ? await queryShared("SELECT 1 AS ok") : { ok: true as const, rows: [{ ok: 1 }] };
  const queue = {
    configured: (process.env.NODE_ENV !== "production" && process.env.INNGEST_DEV === "1") || Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY),
    provider: "inngest",
  };
  const secrets = { configured: !sharedDatabaseEnabled() || secretsConfigured() };
  const readiness = database.ok && (!sharedDatabaseEnabled() || (queue.configured && secrets.configured));
  const response = NextResponse.json({
    status: readiness ? "ready" : "degraded",
    storage: { provider: sharedDatabaseEnabled() ? "postgres" : "sqlite", ready: database.ok },
    queue,
    secrets,
    anthropicConfigured: anthropic.configured,
    keys: { anthropic, openai },
    allowLocalAgents,
  }, { status: request.url.includes("readiness=1") && !readiness ? 503 : 200, headers: { "cache-control": "no-store" } });
  return response;
}
