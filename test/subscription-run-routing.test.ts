import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { insertWorkspace } from "@/server/db";
import { resolveEvaluationProviders } from "@/server/eval-providers";
import { upsertCodexConnection, upsertGitHubConnection } from "@/server/subscription-store";

describe("subscription provider routing", () => {
  it("routes a run to the selected connected subscription", async () => {
    const workspaceId = `provider-routing-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Routing test", createdAt: Date.now() });
    const connection = await upsertGitHubConnection(workspaceId, {
      accountId: "routing-1",
      accountLogin: "routing",
      displayName: "Routing",
      accessToken: "gho_routing",
      refreshToken: null,
      scopes: [],
      expiresAt: null,
    });
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    const resolved = await resolveEvaluationProviders({ workspaceId, subscriptionConnectionId: connection.value.id, runId: "run-1" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.judge.family).toBe("copilot");
      expect(resolved.value.judgeModel).toBe("gpt-5");
    }
  });

  it("rejects a missing subscription instead of silently falling back", async () => {
    const resolved = await resolveEvaluationProviders({ workspaceId: "missing", subscriptionConnectionId: "missing", runId: "run-1" });
    expect(resolved).toEqual({ ok: false, error: "subscription_unavailable" });
  });

  it("rejects an expired subscription before starting an eval", async () => {
    const workspaceId = `expired-routing-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Expired routing test", createdAt: Date.now() });
    const connection = await upsertGitHubConnection(workspaceId, {
      accountId: "routing-expired",
      accountLogin: "expired",
      displayName: "Expired",
      accessToken: "gho_expired",
      refreshToken: null,
      scopes: [],
      expiresAt: Date.now() - 1,
    });
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;

    await expect(resolveEvaluationProviders({
      workspaceId,
      subscriptionConnectionId: connection.value.id,
      runId: "run-expired",
    })).resolves.toEqual({ ok: false, error: "subscription_unavailable" });
  });

  it("routes a local Codex connection to the Codex provider without a stored token", async () => {
    const workspaceId = `codex-routing-${randomUUID()}`;
    insertWorkspace({ id: workspaceId, name: "Codex routing test", createdAt: Date.now() });
    const connection = await upsertCodexConnection(workspaceId, {
      accountId: "codex-account",
      accountLogin: "codex@example.com",
      displayName: "Codex · Plus",
    });
    expect(connection.ok).toBe(true);
    if (!connection.ok) return;
    const resolved = await resolveEvaluationProviders({ workspaceId, subscriptionConnectionId: connection.value.id, runId: "run-codex" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.judge.family).toBe("codex");
      expect(resolved.value.judgeModel).toBe("gpt-5");
    }
  });
});
