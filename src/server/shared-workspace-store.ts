import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WorkspaceKeyRecord, WorkspaceRecord } from "./db";
import { sharedGetWorkspace, sharedInsertWorkspace, sharedInsertWorkspaceKey } from "./shared-store";
import type { WorkspaceRole } from "./rbac";

const DEFAULT_ID = "workspace_local";

export async function getSharedDefaultWorkspace(): Promise<WorkspaceRecord> {
  const existing = await sharedGetWorkspace(DEFAULT_ID);
  if (existing) return existing;
  const workspace: WorkspaceRecord = { id: DEFAULT_ID, name: "Default workspace", createdAt: Date.now() };
  await sharedInsertWorkspace(workspace);
  return (await sharedGetWorkspace(DEFAULT_ID)) ?? workspace;
}

export async function createSharedWorkspaceKey(workspaceId: string, name: string, role: WorkspaceRole = "developer"): Promise<{ ok: true; value: { id: string; name: string; prefix: string; token: string } } | { ok: false; error: string }> {
  const workspace = await sharedGetWorkspace(workspaceId);
  if (!workspace) return { ok: false, error: "workspace_not_found" };
  const prefix = `gk_${randomBytes(5).toString("hex")}`;
  const token = `${prefix}_${randomBytes(24).toString("base64url")}`;
  const key: WorkspaceKeyRecord = { id: randomUUID(), workspaceId, name: name.trim() || "unnamed key", prefix, tokenHash: hashToken(token), role, createdAt: Date.now() };
  const inserted = await sharedInsertWorkspaceKey(key);
  return inserted.ok ? { ok: true, value: { id: key.id, name: key.name, prefix, token } } : { ok: false, error: inserted.error };
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
