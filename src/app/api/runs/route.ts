import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { AgentConnection } from "@/engine/connector";
import { assertAllowedUrl } from "@/engine/ssrf";
import type { ToolDefinition } from "@/engine/types";
import { listRuns } from "@/server/db";
import { startRunAsync } from "@/server/run-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedListRuns } from "@/server/shared-store";
import { getSharedDefaultWorkspace } from "@/server/shared-workspace-store";

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
  /** Tools the agent can call (OpenAI tools[] shape) — optional. */
  tools?: unknown;
  scenarioCount?: number;
  k?: number;
}

/** Loose validation: each entry needs a name + description; parameters is
 * passed through as-is (it's only ever used as LLM context, never executed). */
function parseTools(raw: unknown): ToolDefinition[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const tools: ToolDefinition[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item?.name !== "string" || typeof item?.description !== "string") return null;
    tools.push({
      name: item.name,
      description: item.description,
      parameters:
        typeof item.parameters === "object" && item.parameters !== null
          ? (item.parameters as Record<string, unknown>)
          : undefined,
    });
  }
  return tools;
}

export async function GET() {
  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  const source = sharedDatabaseEnabled() ? await sharedListRuns(workspaceId) : listRuns(workspaceId);
  const runs = source.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    agentName: r.agentName,
    clientName: r.clientName,
    status: r.status,
    score: r.report?.score ?? null,
    certified: r.report?.certified ?? null,
    suite: r.report?.suite ?? null,
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

  const agentName = optionalString(body.agentName);
  const endpointUrl = optionalString(body.endpointUrl);
  const systemPrompt = optionalString(body.systemPrompt);

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

  const tools = parseTools(body.tools);
  if (tools === null) {
    return NextResponse.json(
      { error: "tools debe ser un array de {name, description, parameters?}" },
      { status: 400 },
    );
  }

  if (body.protocol !== undefined && body.protocol !== "openai" && body.protocol !== "coval") return NextResponse.json({ error: "protocol inválido" }, { status: 400 });
  if (body.authType !== undefined && body.authType !== "none" && body.authType !== "bearer" && body.authType !== "header") return NextResponse.json({ error: "authType inválido" }, { status: 400 });
  if (body.authType === "header" && !optionalString(body.authHeaderName)) return NextResponse.json({ error: "authHeaderName es obligatorio con authType header" }, { status: 400 });
  if (body.agentFamily !== undefined && body.agentFamily !== "anthropic" && body.agentFamily !== "openai" && body.agentFamily !== "unknown") return NextResponse.json({ error: "agentFamily inválido" }, { status: 400 });
  if (body.mode !== undefined && body.mode !== "auto" && body.mode !== "conversational" && body.mode !== "task") return NextResponse.json({ error: "mode inválido" }, { status: 400 });
  if (body.scenarioCount !== undefined && (!isFiniteInteger(body.scenarioCount) || body.scenarioCount < 1 || body.scenarioCount > 100)) return NextResponse.json({ error: "scenarioCount debe ser un entero entre 1 y 100" }, { status: 400 });
  if (body.k !== undefined && (!isFiniteInteger(body.k) || body.k < 1 || body.k > 4)) return NextResponse.json({ error: "k debe ser un entero entre 1 y 4" }, { status: 400 });

  const connection: AgentConnection = {
    endpointUrl,
    protocol: body.protocol ?? "openai",
    authType: body.authType ?? "none",
    authToken: optionalString(body.authToken),
    authHeaderName: optionalString(body.authHeaderName),
  };

  const id = randomUUID();
  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  const scenarioCount = body.scenarioCount;
  const config =
    scenarioCount && scenarioCount !== 50
      ? scaleMix(scenarioCount, body.k)
      : body.k
        ? { k: body.k }
        : undefined;

  const started = await startRunAsync(id, {
    agentName,
    clientName: optionalString(body.clientName) || null,
    connection,
    agentSystemPrompt: systemPrompt,
    agentFamily: body.agentFamily ?? "unknown",
    // "auto"/omitted → don't pass a mode at all, so the engine's profiler infers it.
    mode: body.mode && body.mode !== "auto" ? body.mode : undefined,
    tools,
    config,
    workspaceId,
  });

  if (!started) return NextResponse.json({ error: "no se pudo crear la corrida" }, { status: 503 });
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

function isFiniteInteger(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value); }
function optionalString(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
