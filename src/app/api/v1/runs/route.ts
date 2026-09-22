import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isTestSuite, type TestSuite } from "@/engine/suites";
import { getAgent, listRuns } from "@/server/db";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedGetAgent, sharedListRuns } from "@/server/shared-store";
import { runConfigForPreset, toStartRunInput } from "@/server/agent-store";
import { startRunAsync } from "@/server/run-store";
import { subscriptionConnectionAvailable } from "@/server/subscription-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim();
  const runs = (sharedDatabaseEnabled() ? await sharedListRuns(principal.workspace.id) : listRuns(principal.workspace.id))
    .filter((run) => !agentId || run.agentId === agentId)
    .map((run) => ({
      id: run.id,
      agentId: run.agentId,
      agentName: run.agentName,
      clientName: run.clientName,
      status: run.status,
      progress: run.progress,
      score: run.report?.score ?? null,
      certified: run.report?.certified ?? null,
      suite: run.report?.suite ?? null,
      error: run.error,
      createdAt: run.createdAt,
    }));
  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "developer")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const body = await readBody(request);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const input = parseRunInput(body.value);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  if (input.value.subscriptionConnectionId && !await subscriptionConnectionAvailable(principal.workspace.id, input.value.subscriptionConnectionId)) {
    return NextResponse.json({ error: "subscription unavailable" }, { status: 422 });
  }
  const agent = sharedDatabaseEnabled()
    ? await sharedGetAgent(input.value.agentId, principal.workspace.id)
    : getAgent(input.value.agentId, principal.workspace.id);
  if (!agent) return NextResponse.json({ error: "agent no encontrado" }, { status: 404 });
  if (!agent.active) return NextResponse.json({ error: "agent inactivo" }, { status: 409 });
  if (!agent.endpointUrl || !agent.systemPrompt) return NextResponse.json({ error: "agent no ejecutable" }, { status: 409 });
  const runs = sharedDatabaseEnabled()
    ? await sharedListRuns(principal.workspace.id)
    : listRuns(principal.workspace.id);
  if (runs.some((run) => run.agentId === agent.id && (run.status === "queued" || run.status === "running"))) {
    return NextResponse.json({ error: "este agent ya tiene un eval en cola o corriendo" }, { status: 409 });
  }
  const id = randomUUID();
  const started = await startRunAsync(
    id,
    toStartRunInput(
      agent,
      runConfigForPreset(input.value.scenarioCount, input.value.k, input.value.suite),
      input.value.subscriptionConnectionId,
    ),
  );
  if (!started) return NextResponse.json({ error: "no se pudo crear la corrida" }, { status: 503 });
  return NextResponse.json({ id, agentId: agent.id }, { status: 201 });
}

interface RunInput {
  agentId: string;
  scenarioCount: number;
  k: number;
  suite: TestSuite;
  subscriptionConnectionId?: string;
}

async function readBody(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "body debe ser un objeto" };
    return { ok: true, value: raw as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid json" };
  }
}

function parseRunInput(raw: Record<string, unknown>): { ok: true; value: RunInput } | { ok: false; error: string } {
  const agentId = stringValue(raw.agentId);
  const scenarioCount = raw.scenarioCount === undefined ? 10 : raw.scenarioCount;
  const k = raw.k === undefined ? 1 : raw.k;
  const suite = raw.suite === undefined ? "balanced" : raw.suite;
  const subscriptionConnectionId = raw.subscriptionConnectionId === undefined ? undefined : stringValue(raw.subscriptionConnectionId);
  if (!agentId) return { ok: false, error: "agentId es obligatorio" };
  if (!isPresetNumber(scenarioCount, [10, 50]) || !isPresetNumber(k, [1, 4]) || !isTestSuite(suite)) {
    return { ok: false, error: "scenarioCount debe ser 10/50, k debe ser 1/4 y suite debe ser válida" };
  }
  if (raw.subscriptionConnectionId !== undefined && !subscriptionConnectionId) {
    return { ok: false, error: "subscriptionConnectionId debe ser un string no vacío" };
  }
  return { ok: true, value: { agentId, scenarioCount, k, suite, subscriptionConnectionId } };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPresetNumber(value: unknown, allowed: readonly number[]): value is number {
  return typeof value === "number" && allowed.includes(value);
}
