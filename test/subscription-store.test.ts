import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insertWorkspace } from "@/server/db";
import {
  disconnectSubscription,
  getSubscriptionConnection,
  listSubscriptionConnections,
  recordUsage,
  upsertCodexConnection,
  upsertGitHubConnection,
} from "@/server/subscription-store";

describe("subscription store", () => {
  it("upserts a GitHub connection and only exposes a redacted summary", async () => {
    const workspaceId = `subscription-test-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Subscription test", createdAt: Date.now() });

    const first = await upsertGitHubConnection(workspaceId, {
      accountId: "github-42",
      accountLogin: "isidro",
      displayName: "Isidro Pasman",
      accessToken: "gho_secret",
      refreshToken: null,
      scopes: ["read:user"],
      expiresAt: null,
    });
    const second = await upsertGitHubConnection(workspaceId, {
      accountId: "github-42",
      accountLogin: "isidro",
      displayName: "Isidro actualizado",
      accessToken: "gho_secret_2",
      refreshToken: null,
      scopes: ["read:user", "user:email"],
      expiresAt: null,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await listSubscriptionConnections(workspaceId)).toEqual([
      expect.objectContaining({ displayName: "Isidro actualizado", status: "connected" }),
    ]);
    const stored = await getSubscriptionConnection(workspaceId, first.ok ? first.value.id : "missing");
    expect(stored.ok && stored.value?.accessToken).toBe("gho_secret_2");
    expect(JSON.stringify(await listSubscriptionConnections(workspaceId))).not.toContain("gho_secret");
  });

  it("disconnects a connection without deleting its audit identity", async () => {
    const workspaceId = `subscription-test-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Subscription test", createdAt: Date.now() });
    const created = await upsertGitHubConnection(workspaceId, {
      accountId: "github-43",
      accountLogin: "other",
      displayName: "Other",
      accessToken: "gho_other",
      refreshToken: null,
      scopes: [],
      expiresAt: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await disconnectSubscription(workspaceId, created.value.id)).toBe(true);
    const connection = await getSubscriptionConnection(workspaceId, created.value.id);
    expect(connection.ok && connection.value?.status).toBe("revoked");
  });

  it("deduplicates usage entries by request key", async () => {
    const workspaceId = `subscription-test-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Subscription test", createdAt: Date.now() });
    const created = await upsertGitHubConnection(workspaceId, {
      accountId: "github-44",
      accountLogin: "usage",
      displayName: "Usage",
      accessToken: "gho_usage",
      refreshToken: null,
      scopes: [],
      expiresAt: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const usage = {
      workspaceId,
      connectionId: created.value.id,
      runId: "run-1",
      requestKey: "run-1:judge:0",
      model: "gpt-5",
      status: "completed" as const,
      inputTokens: 3,
      outputTokens: 2,
      tokenSource: "estimated" as const,
      error: null,
      createdAt: Date.now(),
      completedAt: Date.now(),
    };
    expect((await recordUsage(usage)).ok).toBe(true);
    expect((await recordUsage(usage)).ok).toBe(true);
  });

  it("stores a Codex connection without persisting an access token", async () => {
    const workspaceId = `subscription-test-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Codex test", createdAt: Date.now() });
    const created = await upsertCodexConnection(workspaceId, {
      accountId: "isidro@example.com",
      accountLogin: "isidro@example.com",
      displayName: "Codex · Pro",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.authMode).toBe("codex_local");
    expect(created.value.accessToken).toBe("");
    expect(await listSubscriptionConnections(workspaceId)).toEqual([
      expect.objectContaining({ provider: "codex", authMode: "codex_local", status: "connected" }),
    ]);
  });
});
