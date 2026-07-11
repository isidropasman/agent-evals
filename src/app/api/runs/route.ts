import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { AgentConnection } from "@/engine/connector";
import { assertAllowedUrl } from "@/engine/ssrf";
import { listRuns } from "@/server/db";
import { startRun } from "@/server/run-store";

export const runtime = "nodejs";

interface CreateRunBody {
  agentName?: string;
  clientName?: string;
  endpointUrl?: string;
  protocol?: "openai" | "coval";
  authType?: "none" | "bearer" | "header";
  authToken?: string;
  authHeaderName?: string;
  systemPrompt?: string;
  agentFamily?: "anthropic" | "openai" | "unknown";
  /** "auto" (or omitted) lets Gauntlet's profiler infer the mode from the
   * system prompt; "conversational"/"task" forces it. */
  mode?: "auto" | "conversational" | "task";
  scenarioCount?: number;
  k?: number;
}

export async function GET() {
  const runs = listRuns().map((r) => ({
    id: r.id,
    agentName: r.agentName,
    clientName: r.clientName,
    status: r.status,
    score: r.report?.score ?? null,
    certified: r.report?.certified ?? null,
    createdAt: r.createdAt,
  }));
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  let body: CreateRunBody;
  try {
    body = (await req.json()) as CreateRunBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const agentName = body.agentName?.trim();
  const endpointUrl = body.endpointUrl?.trim();
  const systemPrompt = body.systemPrompt?.trim();

  if (!agentName || !endpointUrl || !systemPrompt) {
    return NextResponse.json(
      { error: "agentName, endpointUrl y systemPrompt son obligatorios" },
      { status: 400 },
    );
  }

  const urlCheck = await assertAllowedUrl(endpointUrl);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error.message }, { status: 400 });
  }

  const connection: AgentConnection = {
    endpointUrl,
    protocol: body.protocol ?? "openai",
    authType: body.authType ?? "none",
    authToken: body.authToken,
    authHeaderName: body.authHeaderName,
  };

  const id = randomUUID();
  const scenarioCount = body.scenarioCount;
  const config =
    scenarioCount && scenarioCount !== 50
      ? scaleMix(scenarioCount, body.k)
      : body.k
        ? { k: body.k }
        : undefined;

  startRun(id, {
    agentName,
    clientName: body.clientName?.trim() || null,
    connection,
    agentSystemPrompt: systemPrompt,
    agentFamily: body.agentFamily ?? "unknown",
    // "auto"/omitted → don't pass a mode at all, so the engine's profiler infers it.
    mode: body.mode && body.mode !== "auto" ? body.mode : undefined,
    config,
  });

  return NextResponse.json({ id }, { status: 201 });
}

/** Scale the 20/15/15 default mix proportionally to a smaller/larger suite. */
function scaleMix(total: number, k?: number) {
  const happy = Math.max(1, Math.round(total * 0.4));
  const edge = Math.max(1, Math.round(total * 0.3));
  const adversarial = Math.max(1, total - happy - edge);
  return {
    scenarioCount: total,
    mix: { happy_path: happy, edge_case: edge, adversarial },
    ...(k ? { k } : {}),
  };
}
