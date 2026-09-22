import { describe, expect, it, beforeEach } from "vitest";
import {
  createGitHubOAuthState,
  exchangeGitHubCode,
  verifyGitHubOAuthState,
} from "@/server/github-oauth";

describe("GitHub subscription OAuth", () => {
  beforeEach(() => {
    process.env.GAUNTLET_SECRETS_KEY = "a".repeat(64);
    process.env.GITHUB_CLIENT_ID = "client-id";
    process.env.GITHUB_CLIENT_SECRET = "client-secret";
  });

  it("signs state with workspace and expiry and rejects tampering", () => {
    const state = createGitHubOAuthState("workspace-1", 1_000);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(verifyGitHubOAuthState(state.value, 1_001)).toEqual({ ok: true, value: { workspaceId: "workspace-1" } });
    expect(verifyGitHubOAuthState(state.value, 1_001).ok).toBe(false);
    expect(verifyGitHubOAuthState(`${state.value}x`, 1_001).ok).toBe(false);
    expect(verifyGitHubOAuthState(state.value, 301_001).ok).toBe(false);
  });

  it("exchanges an OAuth code and reads the GitHub identity", async () => {
    const calls: string[] = [];
    const result = await exchangeGitHubCode("code", "https://app.test/callback", async (input, init) => {
      calls.push(String(input));
      if (String(input).includes("access_token")) {
        return new Response(JSON.stringify({ access_token: "gho_token", scope: "read:user" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 42, login: "isidro", name: "Isidro Pasman" }), { status: 200 });
    });
    expect(result).toEqual({
      ok: true,
      value: {
        accountId: "42",
        accountLogin: "isidro",
        displayName: "Isidro Pasman",
        accessToken: "gho_token",
        refreshToken: null,
        scopes: ["read:user"],
        expiresAt: null,
      },
    });
    expect(calls).toHaveLength(2);
  });
});
