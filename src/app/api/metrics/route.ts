import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { checkRateLimit, rateLimitKey } from "@/server/rate-limit";
import { sharedDatabaseEnabled, queryShared } from "@/server/shared-db";
import { getSharedTraceStats } from "@/server/shared-trace-store";
import { getWorkspaceTraceStats } from "@/server/trace-store";
import { sharedListGates } from "@/server/shared-store";
import { listRegressionGateSummaries } from "@/server/gate-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const rate = await checkRateLimit(rateLimitKey(request, "metrics:read", principal.workspace.id), 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  const traces = sharedDatabaseEnabled() ? await getSharedTraceStats(principal.workspace.id) : getWorkspaceTraceStats(principal.workspace.id);
  const gates = sharedDatabaseEnabled() ? await sharedListGates(principal.workspace.id, 100) : listRegressionGateSummaries(principal.workspace.id);
  const queue = sharedDatabaseEnabled() ? await queueMetrics(principal.workspace.id) : { queued: 0, running: 0, completed: gates.filter((gate) => gate.completedAt !== null).length };
  return NextResponse.json({ traces, evaluation: { gates: gates.length, pass: gates.filter((gate) => gate.status === "pass").length, fail: gates.filter((gate) => gate.status === "fail").length, regressions: gates.reduce((total, gate) => total + gate.regressions, 0) }, queue }, { headers: { "cache-control": "no-store", "x-ratelimit-remaining": String(rate.remaining) } });
}

async function queueMetrics(workspaceId: string): Promise<{ queued: number; running: number; completed: number }> {
  const result = await queryShared<{ status: string; count: number }>(`SELECT status, COUNT(*) AS count FROM gate_jobs WHERE workspace_id = $1 GROUP BY status`, [workspaceId]);
  const counts = new Map(result.ok ? result.rows.map((row) => [row.status, Number(row.count)]) : []);
  return { queued: counts.get("queued") ?? 0, running: counts.get("running") ?? 0, completed: counts.get("done") ?? 0 };
}
