import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { listWorkspaceSuites } from "@/server/suite-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ suites: await listWorkspaceSuites(getDefaultWorkspace().id) }, { headers: { "cache-control": "no-store" } });
}
