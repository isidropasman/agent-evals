import type {
  SubscriptionConnectionRecord,
  SubscriptionConnectionSummary,
} from "./subscription-types";

export function toSubscriptionSummary(
  connection: SubscriptionConnectionRecord,
): SubscriptionConnectionSummary {
  return {
    id: connection.id,
    provider: connection.provider,
    accountLogin: connection.accountLogin,
    displayName: connection.displayName,
    status: connection.status,
    authMode: connection.authMode,
    expiresAt: connection.expiresAt,
    lastError: connection.lastError,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export function parseOAuthCallback(
  url: URL,
): { ok: true; code: string; state: string } | { ok: false; error: "missing_code" | "missing_state" | "provider_error" } {
  const providerError = url.searchParams.get("error");
  if (providerError) return { ok: false, error: "provider_error" };
  const code = url.searchParams.get("code")?.trim();
  if (!code) return { ok: false, error: "missing_code" };
  const state = url.searchParams.get("state")?.trim();
  if (!state) return { ok: false, error: "missing_state" };
  return { ok: true, code, state };
}

export function estimateTokenCount(text: string): { count: number; source: "estimated" } {
  return { count: text.length === 0 ? 0 : Math.ceil(text.length / 4), source: "estimated" };
}
