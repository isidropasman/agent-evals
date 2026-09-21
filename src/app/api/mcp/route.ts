import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { handleMcpRequest } from "@/mcp/server";
import { isMcpRequest } from "@/mcp/protocol";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!isMcpRequest(body)) return NextResponse.json({ error: "invalid JSON-RPC request" }, { status: 400 });
  const response = await handleMcpRequest(principal.workspace.id, body);
  return response ? NextResponse.json(response) : new Response(null, { status: 202 });
}
