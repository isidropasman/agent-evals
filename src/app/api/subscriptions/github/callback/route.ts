import { NextResponse } from "next/server";
import { parseOAuthCallback } from "@/server/subscription-logic";
import { exchangeGitHubCode, verifyGitHubOAuthState } from "@/server/github-oauth";
import { upsertGitHubConnection } from "@/server/subscription-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const parsed = parseOAuthCallback(new URL(request.url));
  if (!parsed.ok) return redirectResult(request, "error", "oauth_callback_invalid");
  const cookieState = request.headers.get("cookie")?.match(/(?:^|; )gauntlet_github_oauth_state=([^;]+)/)?.[1];
  if (!cookieState || cookieState !== parsed.state) return redirectResult(request, "error", "oauth_state_invalid");
  const state = verifyGitHubOAuthState(parsed.state);
  if (!state.ok) return redirectResult(request, "error", state.error);
  const redirectUri = process.env.GITHUB_OAUTH_CALLBACK_URL?.trim()
    || new URL("/api/subscriptions/github/callback", request.url).toString();
  const exchanged = await exchangeGitHubCode(parsed.code, redirectUri);
  if (!exchanged.ok) return redirectResult(request, "error", exchanged.error);
  const saved = await upsertGitHubConnection(state.value.workspaceId, exchanged.value);
  if (!saved.ok) return redirectResult(request, "error", "subscription_not_saved");
  return redirectResult(request, "connected");
}

function redirectResult(request: Request, result: "connected" | "error", reason?: string): NextResponse {
  const target = new URL("/dashboard", request.url);
  target.searchParams.set("subscription", result);
  if (reason) target.searchParams.set("reason", reason);
  const response = NextResponse.redirect(target);
  response.cookies.delete("gauntlet_github_oauth_state");
  return response;
}
