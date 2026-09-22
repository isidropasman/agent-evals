import { NextResponse } from "next/server";
import { createGitHubOAuthState, githubAuthorizeUrl } from "@/server/github-oauth";
import { subscriptionWorkspaceId } from "@/server/subscription-workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!process.env.GITHUB_CLIENT_ID?.trim() || !process.env.GITHUB_CLIENT_SECRET?.trim()) {
    return NextResponse.json({ error: "GitHub OAuth no está configurado" }, { status: 503 });
  }
  const state = createGitHubOAuthState(await subscriptionWorkspaceId());
  if (!state.ok) return NextResponse.json({ error: "configurá GAUNTLET_SECRETS_KEY para conectar suscripciones" }, { status: 503 });
  const redirectUri = callbackUrl(request);
  const response = NextResponse.redirect(githubAuthorizeUrl(state.value, redirectUri));
  response.cookies.set("gauntlet_github_oauth_state", state.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/subscriptions/github",
  });
  return response;
}

function callbackUrl(request: Request): string {
  return process.env.GITHUB_OAUTH_CALLBACK_URL?.trim()
    || new URL("/api/subscriptions/github/callback", request.url).toString();
}
