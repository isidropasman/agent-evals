import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isTestSuite, type TestSuite } from "@/engine/suites";
import { getAgent, listRuns } from "@/server/db";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedGetAgent, sharedListRuns } from "@/server/shared-store";
import { getSharedDefaultWorkspace } from "@/server/shared-workspace-store";
import { runConfigForPreset, toStartRunInput } from "@/server/agent-store";
import { startRunAsync } from "@/server/run-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { subscriptionConnectionAvailable } from "@/server/subscription-store";

export const runtime = "nodejs";

interface RunPreset {
  scenarioCount: number;
  k: number;
  suite: TestSuite;
  subscriptionConnectionId?: string;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;
  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  const agent = sharedDatabaseEnabled() ? await sharedGetAgent(agentId, workspaceId) : getAgent(agentId, workspaceId);
  if (!agent) return NextResponse.json({ error: "agent no encontrado" }, { status: 404 });
  if (!agent.active) return NextResponse.json({ error: "agent inactivo" }, { status: 409 });
  if (!agent.endpointUrl || !agent.systemPrompt) {
    return NextResponse.json({ error: "este agent solo tiene traces observadas y no se puede ejecutar" }, { status: 409 });
  }
  const runs = sharedDatabaseEnabled() ? await sharedListRuns(workspaceId) : listRuns(workspaceId);
  if (runs.some((run) => run.agentId === agentId && (run.status === "queued" || run.status === "running"))) {
    return NextResponse.json({ error: "este agent ya tiene un eval en cola o corriendo" }, { status: 409 });
  }

  const preset = await parsePreset(req);
  if (!preset.ok) return NextResponse.json({ error: preset.error }, { status: 400 });
  if (preset.value.subscriptionConnectionId && !await subscriptionConnectionAvailable(workspaceId, preset.value.subscriptionConnectionId)) {
    return NextResponse.json({ error: "subscription unavailable" }, { status: 422 });
  }

  const id = randomUUID();
  const started = await startRunAsync(id, toStartRunInput(agent, runConfigForPreset(preset.value.scenarioCount, preset.value.k, preset.value.suite), preset.value.subscriptionConnectionId));
  if (!started) return NextResponse.json({ error: "no se pudo crear la corrida" }, { status: 503 });
  return NextResponse.json({ id, agentId }, { status: 201 });
}

async function parsePreset(
  req: Request,
): Promise<{ ok: true; value: RunPreset } | { ok: false; error: string }> {
  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "body debe ser un objeto" };
  }
  const body = raw as Record<string, unknown>;
  const scenarioCount = body.scenarioCount === undefined ? 10 : body.scenarioCount;
  const k = body.k === undefined ? 1 : body.k;
  const suite = body.suite === undefined ? "balanced" : body.suite;
  if (!isPresetNumber(scenarioCount, [10, 50]) || !isPresetNumber(k, [1, 4]) || !isTestSuite(suite)) {
    return { ok: false, error: "scenarioCount debe ser 10/50 y k debe ser 1/4" };
  }
  const subscriptionConnectionId = body.subscriptionConnectionId === undefined
    ? undefined
    : typeof body.subscriptionConnectionId === "string" && body.subscriptionConnectionId.trim()
      ? body.subscriptionConnectionId.trim()
      : null;
  if (subscriptionConnectionId === null) return { ok: false, error: "subscriptionConnectionId debe ser un string no vacío" };
  return { ok: true, value: { scenarioCount, k, suite, subscriptionConnectionId } };
}

function isPresetNumber(value: unknown, allowed: readonly number[]): value is number {
  return typeof value === "number" && allowed.includes(value);
}
