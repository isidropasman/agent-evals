import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAgent, listRuns } from "@/server/db";
import { runConfigForPreset, toStartRunInput } from "@/server/agent-store";
import { startRun } from "@/server/run-store";

export const runtime = "nodejs";

interface RunPreset {
  scenarioCount: number;
  k: number;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await context.params;
  const agent = getAgent(agentId);
  if (!agent) return NextResponse.json({ error: "agent no encontrado" }, { status: 404 });
  if (!agent.active) return NextResponse.json({ error: "agent inactivo" }, { status: 409 });
  if (listRuns().some((run) => run.agentId === agentId && (run.status === "queued" || run.status === "running"))) {
    return NextResponse.json({ error: "este agent ya tiene un eval en cola o corriendo" }, { status: 409 });
  }

  const preset = await parsePreset(req);
  if (!preset.ok) return NextResponse.json({ error: preset.error }, { status: 400 });

  const id = randomUUID();
  startRun(id, toStartRunInput(agent, runConfigForPreset(preset.value.scenarioCount, preset.value.k)));
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
  if (!isPresetNumber(scenarioCount, [10, 50]) || !isPresetNumber(k, [1, 4])) {
    return { ok: false, error: "scenarioCount debe ser 10/50 y k debe ser 1/4" };
  }
  return { ok: true, value: { scenarioCount, k } };
}

function isPresetNumber(value: unknown, allowed: readonly number[]): value is number {
  return typeof value === "number" && allowed.includes(value);
}
