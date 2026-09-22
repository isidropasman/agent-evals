import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secrets";
import { localDatabase } from "./db";
import { queryShared, sharedDatabaseEnabled, type SharedRow } from "./shared-db";
import { toSubscriptionSummary } from "./subscription-logic";
import type {
  SubscriptionAuthMode,
  SubscriptionConnectionRecord,
  SubscriptionConnectionSummary,
  UsageLedgerEntry,
} from "./subscription-types";

interface GitHubConnectionInput {
  accountId: string;
  accountLogin: string;
  displayName: string;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: number | null;
}

type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface RawConnection extends SharedRow {
  id: string;
  workspace_id: string;
  provider: string;
  account_id: string;
  account_login: string;
  display_name: string;
  status: string;
  auth_mode?: string;
  scopes_json: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface RawUsage extends SharedRow {
  id: string;
  workspace_id: string;
  connection_id: string;
  run_id: string | null;
  request_key: string;
  model: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  token_source: string;
  error: string | null;
  created_at: number;
  completed_at: number;
}

export async function listSubscriptionConnections(
  workspaceId: string,
): Promise<SubscriptionConnectionSummary[]> {
  const rows = sharedDatabaseEnabled()
    ? await queryShared<RawConnection>(
        "SELECT * FROM subscription_connections WHERE workspace_id = $1 ORDER BY updated_at DESC",
        [workspaceId],
      )
    : localRows<RawConnection>(
        "SELECT * FROM subscription_connections WHERE workspace_id = ? ORDER BY updated_at DESC",
        [workspaceId],
      );
  if (!rows.ok) return [];
  return rows.rows
    .map(connectionFromRow)
    .filter((connection): connection is SubscriptionConnectionRecord => connection !== null)
    .map(toSubscriptionSummary);
}

export async function getSubscriptionConnection(
  workspaceId: string,
  id: string,
): Promise<StoreResult<SubscriptionConnectionRecord | null>> {
  const rows = sharedDatabaseEnabled()
    ? await queryShared<RawConnection>(
        "SELECT * FROM subscription_connections WHERE workspace_id = $1 AND id = $2",
        [workspaceId, id],
      )
    : localRows<RawConnection>(
        "SELECT * FROM subscription_connections WHERE workspace_id = ? AND id = ?",
        [workspaceId, id],
      );
  if (!rows.ok) return { ok: false, error: rows.error };
  const row = rows.rows[0];
  return { ok: true, value: row ? connectionFromRow(row) : null };
}

export async function subscriptionConnectionAvailable(workspaceId: string, id: string): Promise<boolean> {
  const connection = await getSubscriptionConnection(workspaceId, id);
  return connection.ok
    && connection.value !== null
    && connection.value.status === "connected"
    && (connection.value.authMode === "codex_local" || Boolean(connection.value.accessToken))
    && (connection.value.expiresAt === null || connection.value.expiresAt > Date.now());
}

export async function upsertGitHubConnection(
  workspaceId: string,
  input: GitHubConnectionInput,
): Promise<StoreResult<SubscriptionConnectionRecord>> {
  const accessToken = encryptSecret(input.accessToken);
  if (!accessToken.ok) return { ok: false, error: accessToken.error };
  const refreshToken = input.refreshToken === null ? { ok: true as const, value: "" } : encryptSecret(input.refreshToken);
  if (!refreshToken.ok) return { ok: false, error: refreshToken.error };
  const now = Date.now();
  const id = randomUUID();
  const params = [
    id,
    workspaceId,
    "github_copilot",
    input.accountId,
    input.accountLogin,
    input.displayName,
    "connected",
    JSON.stringify(input.scopes),
    "oauth_token",
    accessToken.value,
    refreshToken.value || null,
    input.expiresAt,
    null,
    now,
    now,
  ] as const;
  const sql = `INSERT INTO subscription_connections
    (id, workspace_id, provider, account_id, account_login, display_name, status, scopes_json,
     auth_mode, access_token, refresh_token, expires_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, provider, account_id) DO UPDATE SET
      account_login = excluded.account_login,
      display_name = excluded.display_name,
      status = excluded.status,
      auth_mode = excluded.auth_mode,
      scopes_json = excluded.scopes_json,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
    RETURNING *`;
  if (sharedDatabaseEnabled()) {
    const result = await queryShared<RawConnection>(toPostgresSql(sql), params);
    if (!result.ok) return { ok: false, error: result.error };
    const row = result.rows[0];
    const connection = row ? connectionFromRow(row) : null;
    return connection ? { ok: true, value: connection } : { ok: false, error: "subscription connection was not persisted" };
  }
  const row = localDatabase().prepare(sql).get(...params) as RawConnection | undefined;
  const connection = row ? connectionFromRow(row) : null;
  return connection ? { ok: true, value: connection } : { ok: false, error: "subscription connection was not persisted" };
}

export interface CodexConnectionInput {
  accountId: string;
  accountLogin: string;
  displayName: string;
}

export async function upsertCodexConnection(
  workspaceId: string,
  input: CodexConnectionInput,
): Promise<StoreResult<SubscriptionConnectionRecord>> {
  const now = Date.now();
  const params = [
    randomUUID(),
    workspaceId,
    "codex",
    input.accountId,
    input.accountLogin,
    input.displayName,
    "connected",
    "[]",
    "codex_local",
    "",
    null,
    null,
    null,
    now,
    now,
  ] as const;
  const sql = `INSERT INTO subscription_connections
    (id, workspace_id, provider, account_id, account_login, display_name, status, scopes_json,
     auth_mode, access_token, refresh_token, expires_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, provider, account_id) DO UPDATE SET
      account_login = excluded.account_login,
      display_name = excluded.display_name,
      status = excluded.status,
      auth_mode = excluded.auth_mode,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
    RETURNING *`;
  const result = sharedDatabaseEnabled()
    ? await queryShared<RawConnection>(toPostgresSql(sql), params)
    : localQuery<RawConnection>(sql, params);
  if (!result.ok) return { ok: false, error: result.error };
  const row = result.rows[0];
  const connection = row ? connectionFromRow(row) : null;
  return connection ? { ok: true, value: connection } : { ok: false, error: "subscription connection was not persisted" };
}

export async function disconnectSubscription(workspaceId: string, id: string): Promise<boolean> {
  const sql = "UPDATE subscription_connections SET status = 'revoked', access_token = '', refresh_token = NULL, last_error = NULL, updated_at = $1 WHERE workspace_id = $2 AND id = $3 RETURNING id";
  if (sharedDatabaseEnabled()) {
    const result = await queryShared(sql, [Date.now(), workspaceId, id]);
    return result.ok && result.rows.length === 1;
  }
  const result = localDatabase().prepare(sql.replaceAll("$1", "?").replaceAll("$2", "?").replaceAll("$3", "?")).run(Date.now(), workspaceId, id);
  return result.changes === 1;
}

export async function recordUsage(
  entry: Omit<UsageLedgerEntry, "id">,
): Promise<StoreResult<boolean>> {
  const id = randomUUID();
  const sql = `INSERT INTO subscription_usage
    (id, workspace_id, connection_id, run_id, request_key, model, status, input_tokens,
     output_tokens, token_source, error, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, request_key) DO NOTHING`;
  const params = [
    id,
    entry.workspaceId,
    entry.connectionId,
    entry.runId,
    entry.requestKey,
    entry.model,
    entry.status,
    entry.inputTokens,
    entry.outputTokens,
    entry.tokenSource,
    entry.error,
    entry.createdAt,
    entry.completedAt,
  ] as const;
  if (sharedDatabaseEnabled()) {
    const result = await queryShared(toPostgresSql(sql), params);
    return result.ok ? { ok: true, value: result.rows.length === 1 } : { ok: false, error: result.error };
  }
  try {
    const result = localDatabase().prepare(sql).run(...params);
    return { ok: true, value: result.changes === 1 };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listUsage(workspaceId: string, limit = 100): Promise<UsageLedgerEntry[]> {
  const rows = sharedDatabaseEnabled()
    ? await queryShared<RawUsage>("SELECT * FROM subscription_usage WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2", [workspaceId, limit])
    : localRows<RawUsage>("SELECT * FROM subscription_usage WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?", [workspaceId, limit]);
  if (!rows.ok) return [];
  return rows.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    connectionId: row.connection_id,
    runId: row.run_id,
    requestKey: row.request_key,
    model: row.model,
    status: row.status === "completed" ? "completed" : "error",
    inputTokens: numberValue(row.input_tokens),
    outputTokens: numberValue(row.output_tokens),
    tokenSource: row.token_source === "provider" ? "provider" : "estimated",
    error: row.error,
    createdAt: numberValue(row.created_at),
    completedAt: numberValue(row.completed_at),
  }));
}

function localRows<T extends SharedRow>(sql: string, params: readonly unknown[]): { ok: true; rows: T[] } | { ok: false; error: string } {
  try {
    return { ok: true, rows: localDatabase().prepare(sql).all(...params) as T[] };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function localQuery<T extends SharedRow>(sql: string, params: readonly unknown[]): { ok: true; rows: T[] } | { ok: false; error: string } {
  try {
    const row = localDatabase().prepare(sql).get(...params) as T | undefined;
    return { ok: true, rows: row ? [row] : [] };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function toPostgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function connectionFromRow(row: RawConnection): SubscriptionConnectionRecord | null {
  const accessToken = decryptSecret(row.access_token);
  if (!accessToken.ok) return null;
  const refreshToken = row.refresh_token === null ? { ok: true as const, value: "" } : decryptSecret(row.refresh_token);
  if (!refreshToken.ok) return null;
  let scopes: unknown;
  try {
    scopes = JSON.parse(row.scopes_json) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) return null;
  if (row.provider !== "github_copilot" && row.provider !== "codex" && row.provider !== "supergrok") return null;
  if (row.status !== "connected" && row.status !== "expired" && row.status !== "revoked" && row.status !== "error") return null;
  const authMode: SubscriptionAuthMode = row.auth_mode === "codex_local" ? "codex_local" : "oauth_token";
  if (authMode === "codex_local" && row.provider !== "codex") return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    accountId: row.account_id,
    accountLogin: row.account_login,
    displayName: row.display_name,
    status: row.status,
    authMode,
    scopes,
    accessToken: accessToken.value,
    refreshToken: refreshToken.value || null,
    expiresAt: nullableNumber(row.expires_at),
    lastError: row.last_error,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}
