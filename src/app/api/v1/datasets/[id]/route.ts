import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { getDatasetVersionForWorkspace } from "@/server/dataset-store";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const { id } = await params;
  const dataset = await getDatasetVersionForWorkspace(principal.workspace.id, id);
  if (!dataset) return NextResponse.json({ error: "dataset version not found" }, { status: 404 });
  return NextResponse.json({ dataset }, { headers: { "cache-control": "no-store" } });
}
