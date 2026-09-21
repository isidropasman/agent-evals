import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { checkRateLimit, rateLimitKey } from "@/server/rate-limit";
import { recordAudit } from "@/server/audit";
import { parseSuiteInput } from "@/server/http-input";
import { createSuite, listWorkspaceSuites } from "@/server/suite-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const rate = await checkRateLimit(rateLimitKey(request, "suites:read", principal.workspace.id), 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  return NextResponse.json({ suites: await listWorkspaceSuites(principal.workspace.id) }, { headers: { "cache-control": "no-store", "x-ratelimit-remaining": String(rate.remaining) } });
}

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const rate = await checkRateLimit(rateLimitKey(request, "suites:write", principal.workspace.id), 30, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = parseSuiteInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await createSuite(principal.workspace.id, parsed.value);
  if (!result.ok) return NextResponse.json({ error: result.error === "storage" ? "storage unavailable" : result.message }, { status: result.error === "dataset_not_found" || result.error === "agent_not_found" ? 404 : result.error === "conflict" ? 409 : 503 });
  if (result.created) await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "suite.created", "suite", result.value.id, { name: result.value.name, version: result.value.version, datasetChecksum: result.value.datasetChecksum });
  return NextResponse.json({ suite: result.value, created: result.created }, { status: result.created ? 201 : 200, headers: { "cache-control": "no-store", "x-ratelimit-remaining": String(rate.remaining) } });
}
