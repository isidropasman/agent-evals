import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { sharedDatabaseEnabled } from "@/server/shared-db";
import { createSharedWorkspaceKey, getSharedDefaultWorkspace } from "@/server/shared-workspace-store";
import { recordAudit } from "@/server/audit";
import { parseKeyName } from "@/server/http-input";
import { createWorkspaceKey, getDefaultWorkspace } from "@/server/workspace-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseKeyName(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const principal = await principalFromRequest(request);
  if (!principal && sharedDatabaseEnabled()) {
    const bootstrap = process.env.GAUNTLET_BOOTSTRAP_KEY;
    if (!bootstrap || request.headers.get("x-gauntlet-bootstrap") !== bootstrap) {
      return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
    }
    const workspace = await getSharedDefaultWorkspace();
    const created = await createSharedWorkspaceKey(workspace.id, parsed.value, "owner");
    if (!created.ok) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
    await recordAudit({ workspaceId: workspace.id, actorId: null, actorType: "local", request }, "workspace.key_created", "workspace_key", created.value.id);
    return NextResponse.json({ key: created.value }, { status: 201 });
  }
  if (!principal && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  }
  if (principal && !can(principal.role, "admin")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const target = principal?.workspace ?? getDefaultWorkspace();
  const created = sharedDatabaseEnabled() ? await createSharedWorkspaceKey(target.id, parsed.value) : createWorkspaceKey(target.id, parsed.value);
  if (!created.ok) return NextResponse.json({ error: "workspace not found" }, { status: 404 });
  if (principal) await recordAudit({ workspaceId: principal.workspace.id, actorId: principal.actorId, actorType: principal.actorType, request }, "workspace.key_created", "workspace_key", created.value.id);
  return NextResponse.json({ key: created.value }, { status: 201 });
}
