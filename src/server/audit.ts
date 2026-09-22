import { createHash, randomUUID } from "node:crypto";
import { insertAuditEvent } from "./db";
import { sharedAudit } from "./shared-store";
import { sharedDatabaseEnabled } from "./shared-db";

export interface AuditContext {
  workspaceId: string;
  actorId: string | null;
  actorType: "api_key" | "local" | "worker";
  request?: Request;
}
export async function recordAudit(
  context: AuditContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata?: unknown,
): Promise<void> {
  const requestId = context.request?.headers.get("x-request-id") ?? randomUUID();
  const ip = context.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ipHash = ip ? createHash("sha256").update(ip).digest("hex") : null;
  if (sharedDatabaseEnabled()) {
    await sharedAudit({ workspaceId: context.workspaceId, actorId: context.actorId, actorType: context.actorType, action, resourceType, resourceId, requestId, ipHash, metadata });
    return;
  }
  insertAuditEvent({ id: randomUUID(), workspaceId: context.workspaceId, actorId: context.actorId, actorType: context.actorType, action, resourceType, resourceId, requestId, ipHash, metadata, createdAt: Date.now() });
}
