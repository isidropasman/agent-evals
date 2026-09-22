import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { secretKeyMaterial } from "./secrets";

const STATE_TTL_MS = 10 * 60 * 1000;
const usedStates = new Map<string, number>();

export type GitHubOAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "oauth_not_configured" | "invalid_state" | "provider_error" };

interface OAuthStatePayload {
  workspaceId: string;
  nonce: string;
  expiresAt: number;
}

export interface GitHubIdentity {
  accountId: string;
  accountLogin: string;
  displayName: string;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: number | null;
}

export function createGitHubOAuthState(
  workspaceId: string,
  now = Date.now(),
): GitHubOAuthResult<string> {
  const key = secretKeyMaterial();
  if (!key) return { ok: false, error: "oauth_not_configured" };
  const payload: OAuthStatePayload = {
    workspaceId,
    nonce: randomBytes(18).toString("base64url"),
    expiresAt: now + STATE_TTL_MS,
  };
  const encoded = encode(JSON.stringify(payload));
  return { ok: true, value: `${encoded}.${signature(encoded, key)}` };
}

export function verifyGitHubOAuthState(
  state: string,
  now = Date.now(),
): GitHubOAuthResult<{ workspaceId: string }> {
  const key = secretKeyMaterial();
  if (!key) return { ok: false, error: "oauth_not_configured" };
  const [encoded, receivedSignature] = state.split(".");
  if (!encoded || !receivedSignature) return { ok: false, error: "invalid_state" };
  const expectedSignature = signature(encoded, key);
  const left = Buffer.from(receivedSignature, "utf8");
  const right = Buffer.from(expectedSignature, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, error: "invalid_state" };
  let payload: unknown;
  try {
    payload = JSON.parse(decode(encoded)) as unknown;
  } catch {
    return { ok: false, error: "invalid_state" };
  }
  if (!isStatePayload(payload) || payload.expiresAt <= now || usedStates.has(payload.nonce)) {
    return { ok: false, error: "invalid_state" };
  }
  usedStates.set(payload.nonce, payload.expiresAt);
  for (const [nonce, expiresAt] of usedStates) if (expiresAt <= now) usedStates.delete(nonce);
  return { ok: true, value: { workspaceId: payload.workspaceId } };
}

export function githubAuthorizeUrl(state: string, redirectUri: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID?.trim() ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGitHubCode(
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<GitHubOAuthResult<GitHubIdentity>> {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { ok: false, error: "oauth_not_configured" };
  const tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  }).catch(() => null);
  if (!tokenResponse?.ok) return { ok: false, error: "provider_error" };
  const tokenBody = await readJson(tokenResponse);
  const accessToken = stringValue(tokenBody?.access_token);
  if (!accessToken) return { ok: false, error: "provider_error" };
  const identityResponse = await fetcher("https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!identityResponse?.ok) return { ok: false, error: "provider_error" };
  const identityBody = await readJson(identityResponse);
  const accountId = numberOrString(identityBody?.id);
  const accountLogin = stringValue(identityBody?.login);
  if (!accountId || !accountLogin) return { ok: false, error: "provider_error" };
  const scopeText = stringValue(tokenBody?.scope) ?? "";
  const expiresIn = numberValue(tokenBody?.expires_in);
  const refreshToken = stringValue(tokenBody?.refresh_token);
  return {
    ok: true,
    value: {
      accountId,
      accountLogin,
      displayName: stringValue(identityBody?.name) ?? accountLogin,
      accessToken,
      refreshToken: refreshToken ?? null,
      scopes: scopeText.split(",").map((scope) => scope.trim()).filter(Boolean),
      expiresAt: expiresIn && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    },
  };
}

function signature(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function encode(value: string): string { return Buffer.from(value, "utf8").toString("base64url"); }
function decode(value: string): string { return Buffer.from(value, "base64url").toString("utf8"); }

function isStatePayload(value: unknown): value is OAuthStatePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
    && typeof payload.nonce === "string" && payload.nonce.length > 0
    && typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return stringValue(value);
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
