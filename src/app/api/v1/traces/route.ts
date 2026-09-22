import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { getSharedTraces, ingestSharedTrace } from "@/server/shared-trace-store";
import { recordAudit } from "@/server/audit";
import { checkRateLimit, rateLimitKey } from "@/server/rate-limit";
import { normalizeTraceEnvelope } from "@/server/trace-normalizer";
import { ingestTrace } from "@/server/trace-store";
import { getWorkspaceTraces } from "@/server/trace-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const agentId = optionalString(url.searchParams.get("agentId"));
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "limit debe estar entre 1 y 100" }, { status: 400 });
  }
  const rate = await checkRateLimit(rateLimitKey(request, "traces:read", principal.workspace.id), 180, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  const traces = sharedDatabaseEnabled() ? await getSharedTraces(principal.workspace.id, limit, agentId) : getWorkspaceTraces(principal.workspace.id, limit, agentId);
  return NextResponse.json({ traces }, { headers: { "x-ratelimit-remaining": String(rate.remaining) } });
}

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const rate = await checkRateLimit(rateLimitKey(request, "traces:write", principal.workspace.id), 600, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = normalizeTraceEnvelope(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = sharedDatabaseEnabled() ? await ingestSharedTrace(principal.workspace.id, parsed.value) : ingestTrace(principal.workspace.id, parsed.value);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error === "agent_not_found" ? "agent not found" : result.error === "agent_workspace_mismatch" ? "agent belongs to another workspace" : "storage unavailable" },
      { status: result.error === "agent_not_found" ? 404 : result.error === "agent_workspace_mismatch" ? 403 : 503 },
    );
  }
  await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "trace.ingested", "trace", result.value.traceId);
  return NextResponse.json(result.value, { status: result.value.inserted ? 201 : 200, headers: { "x-ratelimit-remaining": String(rate.remaining) } });
}

function optionalString(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
