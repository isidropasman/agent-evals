import { NextResponse } from "next/server";
import { parsePromoteTrace } from "@/server/http-input";
import { promoteTraceToCase, toRegressionCaseSummary } from "@/server/regression-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { promoteSharedTrace } from "@/server/shared-regression-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parsePromoteTrace(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const workspaceId = sharedDatabaseEnabled() ? "workspace_local" : getDefaultWorkspace().id;
  const result = sharedDatabaseEnabled() ? await promoteSharedTrace(workspaceId, parsed.value) : promoteTraceToCase(workspaceId, parsed.value);
  if (!result.ok) return NextResponse.json({ error: promoteError(result.error) }, { status: promoteStatus(result.error) });
  return NextResponse.json({ case: toRegressionCaseSummary(result.value) }, { status: 201 });
}

function promoteStatus(error: "trace_not_found" | "trace_input_missing" | "trace_assertion_missing" | "case_exists"): number {
  if (error === "trace_not_found") return 404;
  if (error === "case_exists") return 409;
  return 422;
}

function promoteError(error: "trace_not_found" | "trace_input_missing" | "trace_assertion_missing" | "case_exists"): string {
  return {
    trace_not_found: "trace not found",
    trace_input_missing: "trace input is required to replay a case",
    trace_assertion_missing: "trace assertion is required to create a case",
    case_exists: "trace is already a regression case",
  }[error];
}
