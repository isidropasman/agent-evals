import {
  getCodexAppServerClient,
  type CodexBridgeError,
} from "./codex-app-server";
import { toSubscriptionSummary } from "./subscription-logic";
import { upsertCodexConnection } from "./subscription-store";
import type { SubscriptionConnectionSummary } from "./subscription-types";

export type CodexProviderStatus = "available" | "unavailable";

export async function codexProviderStatus(): Promise<CodexProviderStatus> {
  const client = await getCodexAppServerClient();
  if (!client.ok) return "unavailable";
  const account = await client.value.readAccount();
  return account.ok ? "available" : "unavailable";
}

export async function connectCodexSubscription(
  workspaceId: string,
): Promise<{ ok: true; value: SubscriptionConnectionSummary } | { ok: false; error: CodexBridgeError | "subscription_not_saved" }> {
  const client = await getCodexAppServerClient();
  if (!client.ok) return client;
  const account = await client.value.readAccount();
  if (!account.ok) return account;
  const saved = await upsertCodexConnection(workspaceId, {
    accountId: account.value.accountId,
    accountLogin: account.value.email ?? account.value.accountId,
    displayName: account.value.planType ? `Codex · ${account.value.planType}` : "Codex",
  });
  if (!saved.ok) return { ok: false, error: "subscription_not_saved" };
  return { ok: true, value: toSubscriptionSummary(saved.value) };
}
