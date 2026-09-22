import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { listSharedRegressionCases } from "@/server/shared-regression-store";
import { getWorkspaceRegressionCases } from "@/server/regression-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  const cases = sharedDatabaseEnabled() ? await listSharedRegressionCases(principal.workspace.id) : getWorkspaceRegressionCases(principal.workspace.id);
  return NextResponse.json({ cases });
}
