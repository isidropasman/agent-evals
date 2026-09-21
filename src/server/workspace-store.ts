import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  getWorkspace,
  getWorkspaceKeyByPrefix,
  insertWorkspace,
  insertWorkspaceKey,
  type WorkspaceKeyRecord,
  type WorkspaceRecord,
} from "./db";

const DEFAULT_WORKSPACE_ID = "workspace_local";
const DEFAULT_WORKSPACE_NAME = "Local workspace";

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

export interface CreatedWorkspaceKey {
  id: string;
  name: string;
  prefix: string;
  token: string;
}

export type CreateWorkspaceKeyResult =
  | { ok: true; value: CreatedWorkspaceKey }
  | { ok: false; error: "workspace_not_found" };

export function getDefaultWorkspace(): Workspace {
  const existing = getWorkspace(DEFAULT_WORKSPACE_ID);
  if (existing) return existing;
  const workspace: WorkspaceRecord = {
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    createdAt: Date.now(),
  };
  insertWorkspace(workspace);
  return workspace;
}

export function createWorkspaceKey(
  workspaceId: string,
  name: string,
): CreateWorkspaceKeyResult {
  if (!getWorkspace(workspaceId)) return { ok: false, error: "workspace_not_found" };
  const secret = randomBytes(24).toString("base64url");
  const prefix = `gk_${randomBytes(5).toString("hex")}`;
  const token = `${prefix}_${secret}`;
  const key: WorkspaceKeyRecord = {
    id: randomUUID(),
    workspaceId,
    name: name.trim() || "unnamed key",
    prefix,
    tokenHash: hashToken(token),
    role: "developer",
    createdAt: Date.now(),
  };
  insertWorkspaceKey(key);
  return { ok: true, value: { id: key.id, name: key.name, prefix, token } };
}

export function resolveWorkspaceKey(raw: string | null): Workspace | null {
  if (!raw) return null;
  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : raw.trim();
  if (!token.startsWith("gk_")) return null;
  const separator = token.indexOf("_", 3);
  if (separator === -1) return null;
  const prefix = token.slice(0, separator);
  const key = getWorkspaceKeyByPrefix(prefix);
  if (!key || !safeEqual(key.tokenHash, hashToken(token))) return null;
  return getWorkspace(key.workspaceId);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
