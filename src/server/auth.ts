import { resolveWorkspaceKey, type Workspace } from "./workspace-store";
import { createHash, timingSafeEqual } from "node:crypto";
import { sharedDatabaseEnabled } from "./shared-db";
import { sharedGetWorkspace, sharedGetWorkspaceKeyByPrefix } from "./shared-store";
import type { WorkspaceRole } from "./rbac";

export interface WorkspacePrincipal {
  workspace: Workspace;
  role: WorkspaceRole;
  actorId: string | null;
  actorType: "api_key" | "local";
}

export function workspaceFromRequest(request: Request): Workspace | null {
  const headerKey = request.headers.get("x-gauntlet-key");
  const authorization = request.headers.get("authorization");
  return resolveWorkspaceKey(headerKey ?? authorization);
}

export async function principalFromRequest(request: Request): Promise<WorkspacePrincipal | null> {
  const raw = request.headers.get("x-gauntlet-key") ?? request.headers.get("authorization");
  if (!raw) return null;
  if (!sharedDatabaseEnabled()) {
    const workspace = workspaceFromRequest(request);
    return workspace ? { workspace, role: "owner", actorId: null, actorType: "local" } : null;
  }
  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : raw.trim();
  const separator = token.indexOf("_", 3);
  if (!token.startsWith("gk_") || separator === -1) return null;
  const key = await sharedGetWorkspaceKeyByPrefix(token.slice(0, separator));
  if (!key || !safeEqual(key.tokenHash, hashToken(token))) return null;
  const workspace = await sharedGetWorkspace(key.workspaceId);
  return workspace ? { workspace, role: key.role, actorId: key.id, actorType: "api_key" } : null;
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
