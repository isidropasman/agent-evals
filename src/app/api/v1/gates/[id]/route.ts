import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { sharedGetGate, sharedListGateCaseResults } from "@/server/shared-store";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!sharedDatabaseEnabled()) return NextResponse.json({ error: "gate detail requires shared storage" }, { status: 404 });
  const { id } = await params;
  const gate = await sharedGetGate(principal.workspace.id, id);
  if (!gate) return NextResponse.json({ error: "gate not found" }, { status: 404 });
  return NextResponse.json({ gate, cases: await sharedListGateCaseResults(principal.workspace.id, id) });
}
