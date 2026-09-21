import { NextResponse } from "next/server";
import { assertAllowedUrl } from "@/engine/ssrf";
import {
  createAgent,
  getAgentDashboard,
  isEvalMode,
  parseTools,
  toPublicAgent,
  type CreateAgentInput,
} from "@/server/agent-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { getWorkspaceTraceStats } from "@/server/trace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { createSharedAgent, getSharedAgentDashboard } from "@/server/shared-agent-store";
import { getSharedTraceStats } from "@/server/shared-trace-store";
import { getSharedDefaultWorkspace } from "@/server/shared-workspace-store";

export const runtime = "nodejs";

export async function GET() {
  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  if (sharedDatabaseEnabled()) return NextResponse.json({ agents: await getSharedAgentDashboard(workspaceId), observability: await getSharedTraceStats(workspaceId) });
  return NextResponse.json({
    agents: getAgentDashboard(workspaceId),
    observability: getWorkspaceTraceStats(workspaceId),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const input = parseCreateAgentInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const urlCheck = await assertAllowedUrl(input.value.endpointUrl);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error.message }, { status: 400 });
  }

  const workspaceId = sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
  const agent = sharedDatabaseEnabled() ? await createSharedAgent(workspaceId, input.value) : createAgent(input.value);
  if (!agent) return NextResponse.json({ error: "no se pudo guardar el agente" }, { status: 503 });
  return NextResponse.json({ agent: toPublicAgent(agent) }, { status: 201 });
}

function parseCreateAgentInput(
  raw: unknown,
): { ok: true; value: CreateAgentInput } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "body debe ser un objeto" };

  const name = stringValue(raw.name);
  const endpointUrl = stringValue(raw.endpointUrl);
  const systemPrompt = stringValue(raw.systemPrompt);
  if (!name || !endpointUrl || !systemPrompt) {
    return { ok: false, error: "name, endpointUrl y systemPrompt son obligatorios" };
  }

  const protocol = raw.protocol === undefined ? "openai" : raw.protocol;
  if (protocol !== "openai" && protocol !== "coval") {
    return { ok: false, error: "protocol debe ser openai o coval" };
  }

  const authType = raw.authType === undefined ? "none" : raw.authType;
  if (authType !== "none" && authType !== "bearer" && authType !== "header") {
    return { ok: false, error: "authType inválido" };
  }
  if (authType === "header" && !stringValue(raw.authHeaderName)) {
    return { ok: false, error: "authHeaderName es obligatorio con authType header" };
  }

  const agentFamily = raw.agentFamily === undefined ? "unknown" : raw.agentFamily;
  if (agentFamily !== "anthropic" && agentFamily !== "openai" && agentFamily !== "unknown") {
    return { ok: false, error: "agentFamily inválido" };
  }

  const mode = raw.mode === undefined ? "auto" : raw.mode;
  if (!isEvalMode(mode)) return { ok: false, error: "mode inválido" };

  const tools = parseTools(raw.tools);
  if (tools === null) {
    return { ok: false, error: "tools debe ser un array de {name, description, parameters?}" };
  }

  return {
    ok: true,
    value: {
      name,
      clientName: nullableString(raw.clientName),
      endpointUrl,
      protocol,
      authType,
      authToken: stringValue(raw.authToken),
      authHeaderName: stringValue(raw.authHeaderName),
      systemPrompt,
      agentFamily,
      mode,
      tools,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nullableString(value: unknown): string | null {
  return stringValue(value) ?? null;
}
