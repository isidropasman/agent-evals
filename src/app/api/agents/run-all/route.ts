import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAgent, listAgents, listRuns } from "@/server/db";
import { runConfigForPreset, toStartRunInput } from "@/server/agent-store";
import { startBatchRun, type BatchRunTask } from "@/server/run-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  const preset = parsePreset(body.value);
  if (!preset.ok) return NextResponse.json({ error: preset.error }, { status: 400 });

  const requestedIds = parseAgentIds(body.value);
  if (!requestedIds.ok) return NextResponse.json({ error: requestedIds.error }, { status: 400 });

  const agents = requestedIds.value
    ? requestedIds.value.map((id) => getAgent(id))
    : listAgents().filter((agent) => agent.active);
  if (agents.some((agent) => !agent)) {
    return NextResponse.json({ error: "uno o más agents no existen" }, { status: 404 });
  }
  const selected = agents.filter((agent): agent is NonNullable<typeof agent> => agent !== null);
  if (selected.length === 0) {
    return NextResponse.json({ error: "no hay agents activos para ejecutar" }, { status: 409 });
  }
  if (selected.some((agent) => !agent.active)) {
    return NextResponse.json({ error: "no se puede ejecutar un agent inactivo" }, { status: 409 });
  }

  const runningAgentIds = new Set(
    listRuns()
      .filter((run) => (run.status === "queued" || run.status === "running") && run.agentId)
      .map((run) => run.agentId)
      .filter((agentId): agentId is string => agentId !== null),
  );
  const busy = selected.find((agent) => runningAgentIds.has(agent.id));
  if (busy) {
    return NextResponse.json(
      { error: `${busy.name} ya tiene un eval en cola o corriendo` },
      { status: 409 },
    );
  }

  const config = runConfigForPreset(preset.value.scenarioCount, preset.value.k);
  const tasks: BatchRunTask[] = selected.map((agent) => ({
    id: randomUUID(),
    input: toStartRunInput(agent, config),
  }));
  startBatchRun(tasks);
  return NextResponse.json(
    { runIds: tasks.map((task) => task.id), queued: tasks.length, maxConcurrent: 2 },
    { status: 202 },
  );
}

function parseAgentIds(
  raw: Record<string, unknown>,
): { ok: true; value: string[] | null } | { ok: false; error: string } {
  const agentIds = raw.agentIds;
  if (agentIds === undefined) return { ok: true, value: null };
  if (!Array.isArray(agentIds) || agentIds.some((id) => typeof id !== "string" || !id.trim())) {
    return { ok: false, error: "agentIds debe ser un array de strings" };
  }
  const normalized = agentIds.map((id) => id.trim());
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, error: "agentIds no puede tener duplicados" };
  }
  return { ok: true, value: normalized };
}

function parsePreset(
  raw: Record<string, unknown>,
): { ok: true; value: { scenarioCount: number; k: number } } | { ok: false; error: string } {
  const scenarioCount = raw.scenarioCount === undefined ? 10 : raw.scenarioCount;
  const k = raw.k === undefined ? 1 : raw.k;
  if (!isPresetNumber(scenarioCount, [10, 50]) || !isPresetNumber(k, [1, 4])) {
    return { ok: false, error: "scenarioCount debe ser 10/50 y k debe ser 1/4" };
  }
  return { ok: true, value: { scenarioCount, k } };
}

async function readBody(
  req: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const raw: unknown = await req.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "body debe ser un objeto" };
    }
    return { ok: true, value: raw as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid json" };
  }
}

function isPresetNumber(value: unknown, allowed: readonly number[]): value is number {
  return typeof value === "number" && allowed.includes(value);
}
