import { describe, expect, it } from "vitest";
import {
  estimateTokenCount,
  parseOAuthCallback,
  toSubscriptionSummary,
} from "@/server/subscription-logic";
import type { SubscriptionConnectionRecord } from "@/server/subscription-types";

const connection: SubscriptionConnectionRecord = {
  id: "c1",
  workspaceId: "workspace_local",
  provider: "github_copilot",
  accountId: "42",
  accountLogin: "isidro",
  displayName: "Isidro Pasman",
  status: "connected",
  authMode: "oauth_token",
  scopes: ["read:user"],
  accessToken: "secret",
  refreshToken: null,
  expiresAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("subscription logic", () => {
  it("classifies an active connection without exposing credentials", () => {
    expect(toSubscriptionSummary(connection)).toEqual({
      id: "c1",
      provider: "github_copilot",
      accountLogin: "isidro",
      displayName: "Isidro Pasman",
      status: "connected",
      authMode: "oauth_token",
      expiresAt: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it("rejects an OAuth callback without a code or state", () => {
    expect(parseOAuthCallback(new URL("https://app.test/callback?code=x")).ok).toBe(false);
    expect(parseOAuthCallback(new URL("https://app.test/callback?state=x")).ok).toBe(false);
  });

  it("estimates tokens deterministically and marks the source", () => {
    expect(estimateTokenCount("12345678")).toEqual({ count: 2, source: "estimated" });
    expect(estimateTokenCount("")).toEqual({ count: 0, source: "estimated" });
  });
});
