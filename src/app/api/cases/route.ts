import { NextResponse } from "next/server";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { getWorkspaceRegressionCases } from "@/server/regression-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { listSharedRegressionCases } from "@/server/shared-regression-store";

export const runtime = "nodejs";

export async function GET() {
  const workspaceId = sharedDatabaseEnabled() ? "workspace_local" : getDefaultWorkspace().id;
  return NextResponse.json({ cases: sharedDatabaseEnabled() ? await listSharedRegressionCases(workspaceId) : getWorkspaceRegressionCases(workspaceId) });
}
