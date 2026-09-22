export type SubscriptionProvider = "github_copilot" | "codex" | "supergrok";

export type SubscriptionStatus = "connected" | "expired" | "revoked" | "error";
export type SubscriptionAuthMode = "oauth_token" | "codex_local";

export interface SubscriptionConnectionRecord {
  id: string;
  workspaceId: string;
  provider: SubscriptionProvider;
  accountId: string;
  accountLogin: string;
  displayName: string;
  status: SubscriptionStatus;
  authMode: SubscriptionAuthMode;
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SubscriptionConnectionSummary {
  id: string;
  provider: SubscriptionProvider;
  accountLogin: string;
  displayName: string;
  status: SubscriptionStatus;
  authMode: SubscriptionAuthMode;
  expiresAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type UsageTokenSource = "estimated" | "provider";

export interface UsageLedgerEntry {
  id: string;
  workspaceId: string;
  connectionId: string;
  runId: string | null;
  requestKey: string;
  model: string;
  status: "completed" | "error";
  inputTokens: number;
  outputTokens: number;
  tokenSource: UsageTokenSource;
  error: string | null;
  createdAt: number;
  completedAt: number;
}
