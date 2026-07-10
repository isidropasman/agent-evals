import { NextResponse } from "next/server";
import { getRun } from "@/server/db";
import { cancelRun } from "@/server/run-store";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (run.status !== "running") {
    return NextResponse.json({ ok: false, error: "la corrida no está en ejecución" });
  }
  const aborted = cancelRun(id);
  return NextResponse.json({ ok: aborted });
}
