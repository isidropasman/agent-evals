import { NextResponse } from "next/server";
import { getRun } from "@/server/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: run.id,
    agentName: run.agentName,
    clientName: run.clientName,
    status: run.status,
    progress: run.progress,
    report: run.report,
    error: run.error,
    createdAt: run.createdAt,
  });
}
