import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { listDatasetVersions } from "@/server/dataset-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ datasets: await listDatasetVersions(getDefaultWorkspace().id) }, { headers: { "cache-control": "no-store" } });
}
