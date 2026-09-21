import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { checkRateLimit, rateLimitKey } from "@/server/rate-limit";
import { recordAudit } from "@/server/audit";
import { parseDatasetVersionInput } from "@/server/http-input";
import { createDatasetVersion, listDatasetVersions } from "@/server/dataset-store";
import type { DatasetVersionRecord } from "@/server/dataset-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401, headers: { "cache-control": "no-store" } });
  const rate = await checkRateLimit(rateLimitKey(request, "datasets:read", principal.workspace.id), 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  return NextResponse.json({ datasets: await listDatasetVersions(principal.workspace.id) }, { headers: { "cache-control": "no-store", "x-ratelimit-remaining": String(rate.remaining) } });
}

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const rate = await checkRateLimit(rateLimitKey(request, "datasets:write", principal.workspace.id), 20, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = parseDatasetVersionInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await createDatasetVersion(principal.workspace.id, parsed.value.name, parsed.value.version, parsed.value.items);
  if (!result.ok) return NextResponse.json({ error: result.error === "conflict" ? result.message : "storage unavailable" }, { status: result.error === "conflict" ? 409 : 503 });
  if (result.created) await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "dataset.version_created", "dataset_version", result.value.id, { name: result.value.name, version: result.value.version, itemCount: result.value.itemCount, checksum: result.value.checksum });
  return NextResponse.json({ dataset: summary(result.value), created: result.created }, { status: result.created ? 201 : 200, headers: { "cache-control": "no-store", "x-ratelimit-remaining": String(rate.remaining) } });
}

function summary(value: DatasetVersionRecord) {
  const { items: _items, ...result } = value;
  return result;
}
