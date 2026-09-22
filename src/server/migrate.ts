import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureSharedSchema, transactionShared, type SharedRow, type SharedTransactionStatement } from "./shared-db";
import { encryptSecret } from "./secrets";

export interface MigrationReport {
  source: string;
  tables: Record<string, number>;
  skipped: number;
}

export async function migrateSqliteToShared(sourcePath = path.join(process.cwd(), "data", "gauntlet.db")): Promise<{ ok: true; value: MigrationReport } | { ok: false; error: string }> {
  if (!existsSync(sourcePath)) return { ok: false, error: `SQLite source not found: ${sourcePath}` };
  const schema = await ensureSharedSchema();
  if (!schema.ok) return { ok: false, error: schema.error };
  const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const statements: SharedTransactionStatement[] = [];
    const labels: string[] = [];
    const add = (label: string, query: string, params: readonly unknown[]): void => {
      labels.push(label);
      statements.push({ query, params });
    };

    const workspaces = optionalRows(sqlite, "workspaces");
    if (workspaces.length === 0) add("workspaces", "INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING 1", ["workspace_local", "Local workspace", Date.now()]);
    for (const row of workspaces) add("workspaces", "INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.name, row.created_at]);
    for (const row of optionalRows(sqlite, "workspace_keys")) add("workspace_keys", "INSERT INTO workspace_keys (id, workspace_id, name, prefix, token_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.workspace_id, row.name, row.prefix, row.token_hash, row.role ?? "developer", row.created_at]);

    for (const row of optionalRows(sqlite, "agents")) {
      const encrypted = encryptSecret(nullableString(row.auth_token));
      if (!encrypted.ok) return { ok: false, error: `agent ${String(row.id)} secret could not be encrypted: ${encrypted.error}` };
      add("agents", `INSERT INTO agents (id, workspace_id, name, client_name, endpoint_url, protocol, auth_type, auth_token, auth_header_name, system_prompt, agent_family, mode, tools_json, active, source, external_id, last_trace_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (id) DO NOTHING RETURNING 1`, [row.id, row.workspace_id ?? "workspace_local", row.name, row.client_name, row.endpoint_url, row.protocol, row.auth_type, encrypted.value || null, row.auth_header_name, row.system_prompt, row.agent_family, row.mode, row.tools_json, Boolean(row.active), row.source, row.external_id, row.last_trace_at, row.created_at, row.updated_at]);
    }

    for (const row of optionalRows(sqlite, "runs")) add("runs", `INSERT INTO runs (id, workspace_id, agent_id, agent_name, client_name, endpoint_url, status, progress_json, report_json, error, subscription_connection_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING RETURNING 1`, [row.id, row.workspace_id ?? "workspace_local", row.agent_id, row.agent_name, row.client_name, row.endpoint_url, row.status, row.progress_json, row.report_json, row.error, row.subscription_connection_id ?? null, row.created_at]);
    for (const row of optionalRows(sqlite, "eval_datasets")) add("eval_datasets", "INSERT INTO eval_datasets (id, workspace_id, name, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.workspace_id ?? "workspace_local", row.name, row.created_at]);
    for (const row of optionalRows(sqlite, "eval_dataset_versions")) add("eval_dataset_versions", "INSERT INTO eval_dataset_versions (id, dataset_id, workspace_id, version, checksum, item_count, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.dataset_id, row.workspace_id ?? "workspace_local", row.version, row.checksum, row.item_count, row.created_at]);
    for (const row of optionalRows(sqlite, "eval_dataset_items")) add("eval_dataset_items", "INSERT INTO eval_dataset_items (id, version_id, workspace_id, position, input_json, expected_output_json, evaluator_json, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.version_id, row.workspace_id ?? "workspace_local", row.position, row.input_json, row.expected_output_json, row.evaluator_json, row.metadata_json]);
    for (const row of optionalRows(sqlite, "eval_suites")) add("eval_suites", "INSERT INTO eval_suites (id, workspace_id, name, version, dataset_version_id, agent_id, max_cases, concurrency, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.workspace_id ?? "workspace_local", row.name, row.version, row.dataset_version_id, row.agent_id, row.max_cases, row.concurrency, row.created_at]);
    for (const row of optionalRows(sqlite, "traces")) add("traces", `INSERT INTO traces (workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id, kind, input_json, output_json, tool_name, tool_arguments_json, tool_result_json, latency_ms, status, assertion_json, occurred_at, metadata_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) ON CONFLICT (workspace_id, event_id) DO NOTHING RETURNING 1`, [row.workspace_id ?? "workspace_local", row.event_id, row.trace_id, row.agent_id, row.deployment, row.version, row.parent_id, row.kind, row.input_json, row.output_json, row.tool_name, row.tool_arguments_json, row.tool_result_json, row.latency_ms, row.status, row.assertion_json, row.occurred_at, row.metadata_json]);
    for (const row of optionalRows(sqlite, "regression_cases")) add("regression_cases", `INSERT INTO regression_cases (id, workspace_id, agent_id, source_trace_id, suite_id, name, input_json, assertion_name, assertion_detail, evaluator_json, expected_pass, last_status, last_passed, last_latency_ms, last_error, last_run_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) ON CONFLICT (id) DO NOTHING RETURNING 1`, [row.id, row.workspace_id ?? "workspace_local", row.agent_id, row.source_trace_id, row.suite_id, row.name, row.input_json, row.assertion_name, row.assertion_detail, row.evaluator_json, Boolean(row.expected_pass), row.last_status, nullableBoolean(row.last_passed), row.last_latency_ms, row.last_error, row.last_run_at, row.created_at, row.updated_at]);
    for (const row of optionalRows(sqlite, "regression_gate_runs")) add("regression_gate_runs", `INSERT INTO regression_gate_runs (id, workspace_id, version, baseline_version, status, total, passed, failed, errors, regressions, created_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING RETURNING 1`, [row.id, row.workspace_id ?? "workspace_local", row.version, row.baseline_version, row.status, row.total, row.passed, row.failed, row.errors, row.regressions, row.created_at, row.completed_at]);
    for (const row of optionalRows(sqlite, "regression_gate_case_results")) add("regression_gate_case_results", `INSERT INTO regression_gate_case_results (gate_run_id, workspace_id, case_id, agent_id, status, passed, baseline_status, regression, latency_ms, error, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (gate_run_id, case_id) DO NOTHING RETURNING 1`, [row.gate_run_id, row.workspace_id ?? "workspace_local", row.case_id, row.agent_id, row.status, nullableBoolean(row.passed), row.baseline_status, Boolean(row.regression), row.latency_ms, row.error, row.created_at]);
    for (const row of optionalRows(sqlite, "gate_jobs")) add("gate_jobs", "INSERT INTO gate_jobs (id, workspace_id, gate_run_id, status, attempts, available_at, last_error, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.workspace_id ?? "workspace_local", row.gate_run_id, row.status, row.attempts ?? 0, row.available_at, row.last_error, row.created_at, row.updated_at]);
    for (const row of optionalRows(sqlite, "audit_events")) add("audit_events", "INSERT INTO audit_events (id, workspace_id, actor_id, actor_type, action, resource_type, resource_id, request_id, ip_hash, metadata_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.workspace_id ?? "workspace_local", row.actor_id, row.actor_type, row.action, row.resource_type, row.resource_id, row.request_id, row.ip_hash, row.metadata_json, row.created_at]);
    for (const row of optionalRows(sqlite, "subscription_connections")) {
      const codexLocal = row.provider === "codex" && row.auth_mode === "codex_local";
      const accessToken = codexLocal
        ? { ok: true as const, value: "" }
        : ensureEncrypted(typeof row.access_token === "string" ? row.access_token : "");
      if (!accessToken.ok) return { ok: false, error: `subscription ${String(row.id)} secret could not be encrypted: ${accessToken.error}` };
      const refreshToken = codexLocal || row.refresh_token === null || row.refresh_token === undefined
        ? { ok: true as const, value: null }
        : ensureEncrypted(nullableString(row.refresh_token));
      if (!refreshToken.ok) return { ok: false, error: `subscription ${String(row.id)} refresh secret could not be encrypted: ${refreshToken.error}` };
      add("subscription_connections", `INSERT INTO subscription_connections (id, workspace_id, provider, account_id, account_login, display_name, status, scopes_json, auth_mode, access_token, refresh_token, expires_at, last_error, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (id) DO NOTHING RETURNING 1`, [row.id, row.workspace_id ?? "workspace_local", row.provider, row.account_id, row.account_login, row.display_name, row.status, row.scopes_json ?? "[]", row.auth_mode === "codex_local" ? "codex_local" : "oauth_token", accessToken.value, refreshToken.value, row.expires_at, row.last_error, row.created_at, row.updated_at]);
    }
    for (const row of optionalRows(sqlite, "subscription_usage")) add("subscription_usage", "INSERT INTO subscription_usage (id, workspace_id, connection_id, run_id, request_key, model, status, input_tokens, output_tokens, token_source, error, created_at, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO NOTHING RETURNING 1", [row.id, row.workspace_id ?? "workspace_local", row.connection_id, row.run_id, row.request_key, row.model, row.status, row.input_tokens, row.output_tokens, row.token_source, row.error, row.created_at, row.completed_at]);

    const migrated = await transactionShared(statements);
    if (!migrated.ok) return { ok: false, error: migrated.error };
    const tables: Record<string, number> = {};
    let skipped = 0;
    for (const [index, result] of migrated.results.entries()) {
      const label = labels[index];
      if (!label) continue;
      if (result.length === 1) tables[label] = (tables[label] ?? 0) + 1;
      else skipped += 1;
    }
    return { ok: true, value: { source: sourcePath, tables, skipped } };
  } finally {
    sqlite.close();
  }
}

function optionalRows(sqlite: Database.Database, table: string): SharedRow[] {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return exists ? sqlite.prepare(`SELECT * FROM ${table}`).all() as SharedRow[] : [];
}

function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function nullableBoolean(value: unknown): boolean | null { return value === null || value === undefined ? null : Boolean(value); }

function ensureEncrypted(value: string | null): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value.startsWith("enc:v1:")) return { ok: true, value };
  return encryptSecret(value);
}
