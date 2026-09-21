import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { checkRateLimit, rateLimitKey } from "@/server/rate-limit";
import { recordAudit } from "@/server/audit";
import { normalizeTraceEnvelope } from "@/server/trace-normalizer";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { ingestSharedTrace } from "@/server/shared-trace-store";
import { ingestTrace } from "@/server/trace-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const rate = await checkRateLimit(rateLimitKey(request, "traces:batch", principal.workspace.id), 60, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!isRecord(body) || !Array.isArray(body.traces)) return NextResponse.json({ error: "traces debe ser un array" }, { status: 400 });
  if (body.traces.length > 100) return NextResponse.json({ error: "traces no puede superar 100 elementos" }, { status: 413 });
  const accepted: string[] = [];
  const duplicates: string[] = [];
  const rejected: Array<{ index: number; error: string }> = [];
  for (const [index, raw] of body.traces.entries()) {
    const parsed = normalizeTraceEnvelope(raw);
    if (!parsed.ok) { rejected.push({ index, error: parsed.error }); continue; }
    const result = sharedDatabaseEnabled() ? await ingestSharedTrace(principal.workspace.id, parsed.value) : ingestTrace(principal.workspace.id, parsed.value);
    if (!result.ok) { rejected.push({ index, error: result.error === "agent_not_found" ? "agent not found" : result.error === "agent_workspace_mismatch" ? "agent belongs to another workspace" : "storage unavailable" }); continue; }
    (result.value.inserted ? accepted : duplicates).push(parsed.value.eventId);
  }
  await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "traces.batch_ingested", "trace_batch", null, { received: body.traces.length, accepted: accepted.length, duplicates: duplicates.length, rejected: rejected.length });
  return NextResponse.json({ accepted, duplicates, rejected }, { headers: { "cache-control": "no-store", "x-ratelimit-remaining": String(rate.remaining) } });
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
