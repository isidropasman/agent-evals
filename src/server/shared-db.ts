import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type SharedRow = Record<string, unknown>;
export type SharedQueryResult<T extends SharedRow = SharedRow> =
  | { ok: true; rows: T[] }
  | { ok: false; error: string };

export interface SharedTransactionStatement {
  query: string;
  params: readonly unknown[];
}

export type SharedTransactionResult =
  | { ok: true; results: SharedRow[][] }
  | { ok: false; error: string };

let client: NeonQueryFunction<false, false> | null = null;
let schemaPromise: Promise<SharedQueryResult> | null = null;

export function sharedDatabaseUrl(): string | null {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const normalized = value?.trim();
  return normalized || null;
}

export function sharedDatabaseEnabled(): boolean {
  return Boolean(sharedDatabaseUrl()) && process.env.GAUNTLET_STORAGE !== "sqlite";
}

export async function ensureSharedSchema(): Promise<SharedQueryResult> {
  if (!sharedDatabaseEnabled()) return { ok: false, error: "shared database is not configured" };
  if (!schemaPromise) schemaPromise = initializeSchema();
  const result = await schemaPromise;
  if (!result.ok) schemaPromise = null;
  return result;
}

export async function queryShared<T extends SharedRow = SharedRow>(
  query: string,
  params: readonly unknown[] = [],
): Promise<SharedQueryResult<T>> {
  const schema = await ensureSharedSchema();
  if (!schema.ok) return schema;
  try {
    const rows = await getClient().query(query, [...params]);
    return { ok: true, rows: rows as T[] };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function transactionShared(statements: readonly SharedTransactionStatement[]): Promise<SharedTransactionResult> {
  const schema = await ensureSharedSchema();
  if (!schema.ok) return { ok: false, error: schema.error };
  try {
    const results = await getClient().transaction(
      statements.map(({ query, params }) => getClient().query(query, [...params])),
    );
    return { ok: true, results: results as SharedRow[][] };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function getClient(): NeonQueryFunction<false, false> {
  if (client) return client;
  const url = sharedDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is required for shared database access");
  client = neon(url);
  return client;
}

async function initializeSchema(): Promise<SharedQueryResult> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS workspace_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      prefix TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (workspace_id, subject)
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      client_name TEXT,
      endpoint_url TEXT NOT NULL,
      protocol TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      auth_token TEXT,
      auth_header_name TEXT,
      system_prompt TEXT NOT NULL,
      agent_family TEXT NOT NULL,
      mode TEXT,
      tools_json TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      last_trace_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (workspace_id, external_id)
    )`,
    `CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      agent_id TEXT,
      agent_name TEXT NOT NULL,
      client_name TEXT,
      endpoint_url TEXT NOT NULL,
      status TEXT NOT NULL,
      cancel_requested BOOLEAN NOT NULL DEFAULT false,
      progress_json TEXT,
      report_json TEXT,
      error TEXT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS traces (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      event_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      deployment TEXT,
      version TEXT,
      parent_id TEXT,
      kind TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      tool_name TEXT,
      tool_arguments_json TEXT,
      tool_result_json TEXT,
      latency_ms INTEGER,
      status TEXT,
      assertion_json TEXT,
      occurred_at BIGINT NOT NULL,
      metadata_json TEXT,
      PRIMARY KEY (workspace_id, event_id)
    )`,
    `CREATE TABLE IF NOT EXISTS regression_cases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      source_trace_id TEXT NOT NULL,
      suite_id TEXT,
      name TEXT NOT NULL,
      input_json TEXT NOT NULL,
      assertion_name TEXT NOT NULL,
      assertion_detail TEXT,
      evaluator_json TEXT,
      expected_pass BOOLEAN NOT NULL DEFAULT true,
      last_status TEXT,
      last_passed BOOLEAN,
      last_latency_ms INTEGER,
      last_error TEXT,
      last_run_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (workspace_id, agent_id, source_trace_id)
    )`,
    `CREATE TABLE IF NOT EXISTS regression_gate_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version TEXT NOT NULL,
      baseline_version TEXT,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      regressions INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      completed_at BIGINT
    )`,
    `CREATE TABLE IF NOT EXISTS regression_gate_case_results (
      gate_run_id TEXT NOT NULL REFERENCES regression_gate_runs(id),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      case_id TEXT NOT NULL REFERENCES regression_cases(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL,
      passed BOOLEAN,
      baseline_status TEXT,
      regression BOOLEAN NOT NULL DEFAULT false,
      latency_ms INTEGER,
      error TEXT,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (gate_run_id, case_id)
    )`,
    `CREATE TABLE IF NOT EXISTS eval_datasets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE (workspace_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS eval_dataset_versions (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL REFERENCES eval_datasets(id),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version TEXT NOT NULL,
      checksum TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE (workspace_id, dataset_id, version)
    )`,
    `CREATE TABLE IF NOT EXISTS eval_dataset_items (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL REFERENCES eval_dataset_versions(id),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      position INTEGER NOT NULL,
      input_json TEXT NOT NULL,
      expected_output_json TEXT,
      evaluator_json TEXT,
      metadata_json TEXT,
      UNIQUE (version_id, position)
    )`,
    `CREATE TABLE IF NOT EXISTS eval_suites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      dataset_version_id TEXT NOT NULL REFERENCES eval_dataset_versions(id),
      agent_id TEXT,
      max_cases INTEGER,
      concurrency INTEGER,
      created_at BIGINT NOT NULL,
      UNIQUE (workspace_id, name, version)
    )`,
    `CREATE TABLE IF NOT EXISTS gate_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      gate_run_id TEXT NOT NULL UNIQUE REFERENCES regression_gate_runs(id),
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at BIGINT NOT NULL,
      locked_at BIGINT,
      last_error TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      actor_id TEXT,
      actor_type TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      request_id TEXT,
      ip_hash TEXT,
      metadata_json TEXT,
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY,
      window_started_at BIGINT NOT NULL,
      count INTEGER NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_shared_traces_workspace_time ON traces(workspace_id, occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_runs_workspace_time ON runs(workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_gates_workspace_time ON regression_gate_runs(workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_shared_audit_workspace_time ON audit_events(workspace_id, created_at DESC)`,
    `INSERT INTO schema_migrations (version) VALUES ('0001-production-foundation') ON CONFLICT (version) DO NOTHING`,
    `ALTER TABLE regression_cases ADD COLUMN IF NOT EXISTS evaluator_json TEXT`,
    `ALTER TABLE regression_cases ADD COLUMN IF NOT EXISTS suite_id TEXT`,
    `ALTER TABLE eval_suites ADD COLUMN IF NOT EXISTS agent_id TEXT`,
    `ALTER TABLE runs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false`,
  ];
  try {
    for (const statement of statements) {
      await getClient().query(statement);
    }
    return { ok: true, rows: [] };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
