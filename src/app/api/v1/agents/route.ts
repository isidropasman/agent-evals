import { NextResponse } from "next/server";
import { assertAllowedUrl } from "@/engine/ssrf";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { getSharedAgentDashboard, registerSharedAgent } from "@/server/shared-agent-store";
import { recordAudit } from "@/server/audit";
import { checkRateLimit, rateLimitKey } from "@/server/rate-limit";
import { parseAgentRegistration } from "@/server/http-input";
import { registerWorkspaceAgent, toPublicAgent } from "@/server/agent-store";
import { getAgentDashboard } from "@/server/agent-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const rate = await checkRateLimit(rateLimitKey(request, "agents:read", principal.workspace.id), 120, 60_000);
  if (!rate.allowed) return rateLimited(rate);
  const agents = sharedDatabaseEnabled() ? await getSharedAgentDashboard(principal.workspace.id) : getAgentDashboard(principal.workspace.id);
  return NextResponse.json({ agents }, { headers: rateHeaders(rate) });
}

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const rate = await checkRateLimit(rateLimitKey(request, "agents:write", principal.workspace.id), 30, 60_000);
  if (!rate.allowed) return rateLimited(rate);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseAgentRegistration(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.value.endpointUrl) {
    const urlCheck = await assertAllowedUrl(parsed.value.endpointUrl);
    if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error.message }, { status: 400 });
  }
  const registered = sharedDatabaseEnabled()
    ? await registerSharedAgent(principal.workspace.id, parsed.value)
    : registerWorkspaceAgent(principal.workspace.id, parsed.value);
  if (!registered.ok) return NextResponse.json({ error: "agent already exists" }, { status: 409 });
  if (registered.created) await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "agent.created", "agent", registered.value.id, { source: parsed.value.source });
  return NextResponse.json(
    { agent: toPublicAgent(registered.value), created: registered.created },
    { status: registered.created ? 201 : 200, headers: rateHeaders(rate) },
  );
}

function rateHeaders(rate: { limit: number; remaining: number; resetAt: number }): HeadersInit { return { "x-ratelimit-limit": String(rate.limit), "x-ratelimit-remaining": String(rate.remaining), "x-ratelimit-reset": String(rate.resetAt) }; }
function rateLimited(rate: { resetAt: number }): NextResponse { return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) } }); }
