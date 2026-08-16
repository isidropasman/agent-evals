import { NextResponse } from "next/server";
import { probeAgent, type AgentConnection } from "@/engine/connector";
import { assertAllowedUrl } from "@/engine/ssrf";
import { keyStatus } from "@/server/keys";

export const runtime = "nodejs";

interface PreflightBody {
  endpointUrl?: string;
  protocol?: "openai" | "coval";
  authType?: "none" | "bearer" | "header";
  authToken?: string;
  authHeaderName?: string;
}

export async function POST(req: Request) {
  let body: PreflightBody;
  try {
    body = (await req.json()) as PreflightBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const endpointUrl = body.endpointUrl?.trim();
  if (!endpointUrl) {
    return NextResponse.json({ error: "endpointUrl requerido" }, { status: 400 });
  }

  const urlCheck = await assertAllowedUrl(endpointUrl);
  if (!urlCheck.ok) {
    return NextResponse.json({ ok: false, error: urlCheck.error.message });
  }

  const connection: AgentConnection = {
    endpointUrl,
    protocol: body.protocol ?? "openai",
    authType: body.authType ?? "none",
    authToken: body.authToken,
    authHeaderName: body.authHeaderName,
  };

  const probe = await probeAgent(connection);
  if (!probe.ok) {
    return NextResponse.json({ ok: false, error: probe.error.message });
  }

  return NextResponse.json({
    ok: true,
    reply: probe.value.slice(0, 500),
    anthropicConfigured: keyStatus("anthropic").configured,
  });
}
