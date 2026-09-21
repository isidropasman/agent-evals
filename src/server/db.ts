import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { EvalMode, RunProgress, RunReport, ToolDefinition } from "@/engine/types";
import type { EvaluatorDefinition } from "@/engine/evaluators";
import type { DatasetItem, DatasetVersionRecord } from "./dataset-store";
import type { SuiteRecord } from "./suite-store";

let _db: Database.Database | null = null;

// Lazy connection: opening at import time would run during `next build`'s
// page-data collection and lock the file across route modules.
function db(): Database.Database {
  if (_db) return _db;
  const dataDir = process.env.GAUNTLET_DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const conn = new Database(path.join(dataDir, "gauntlet.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace_local',
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
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      last_trace_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace_local',
      agent_id TEXT,
      agent_name TEXT NOT NULL,
      client_name TEXT,
      endpoint_url TEXT NOT NULL,
      status TEXT NOT NULL,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      progress_json TEXT,
      report_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, subject),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_id TEXT,
      actor_type TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      request_id TEXT,
      ip_hash TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS traces (
      workspace_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
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
      occurred_at INTEGER NOT NULL,
      metadata_json TEXT,
      PRIMARY KEY (workspace_id, event_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE TABLE IF NOT EXISTS regression_cases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_trace_id TEXT NOT NULL,
      suite_id TEXT,
      name TEXT NOT NULL,
      input_json TEXT NOT NULL,
      assertion_name TEXT NOT NULL,
      assertion_detail TEXT,
      evaluator_json TEXT,
      expected_pass INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      last_passed INTEGER,
      last_latency_ms INTEGER,
      last_error TEXT,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (workspace_id, agent_id, source_trace_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE TABLE IF NOT EXISTS regression_gate_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      version TEXT NOT NULL,
      baseline_version TEXT,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      regressions INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS regression_gate_case_results (
      gate_run_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      passed INTEGER,
      baseline_status TEXT,
      regression INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (gate_run_id, case_id),
      FOREIGN KEY (gate_run_id) REFERENCES regression_gate_runs(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (case_id) REFERENCES regression_cases(id)
    );
    CREATE TABLE IF NOT EXISTS eval_datasets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (workspace_id, name),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS eval_dataset_versions (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      version TEXT NOT NULL,
      checksum TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (workspace_id, dataset_id, version),
      FOREIGN KEY (dataset_id) REFERENCES eval_datasets(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS eval_dataset_items (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      input_json TEXT NOT NULL,
      expected_output_json TEXT,
      evaluator_json TEXT,
      metadata_json TEXT,
      UNIQUE (version_id, position),
      FOREIGN KEY (version_id) REFERENCES eval_dataset_versions(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS eval_suites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      dataset_version_id TEXT NOT NULL,
      agent_id TEXT,
      max_cases INTEGER,
      concurrency INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (workspace_id, name, version),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (dataset_version_id) REFERENCES eval_dataset_versions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_regression_gate_runs_workspace
      ON regression_gate_runs(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_regression_gate_case_results_case
      ON regression_gate_case_results(workspace_id, case_id, created_at DESC);
  `);
  const agentColumns = conn.pragma("table_info(agents)") as Array<{ name: string }>;
  if (!agentColumns.some((column) => column.name === "workspace_id")) {
    conn.exec(`ALTER TABLE agents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace_local'`);
  }
  if (!agentColumns.some((column) => column.name === "source")) {
    conn.exec(`ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
  }
  if (!agentColumns.some((column) => column.name === "external_id")) {
    conn.exec(`ALTER TABLE agents ADD COLUMN external_id TEXT`);
  }
  if (!agentColumns.some((column) => column.name === "last_trace_at")) {
    conn.exec(`ALTER TABLE agents ADD COLUMN last_trace_at INTEGER`);
  }
  conn.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_workspace_external ON agents(workspace_id, external_id) WHERE external_id IS NOT NULL`);
  const runColumns = conn.pragma("table_info(runs)") as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === "workspace_id")) {
    conn.exec(`ALTER TABLE runs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace_local'`);
  }
  if (!runColumns.some((column) => column.name === "agent_id")) {
    conn.exec(`ALTER TABLE runs ADD COLUMN agent_id TEXT`);
  }
  if (!runColumns.some((column) => column.name === "cancel_requested")) {
    conn.exec(`ALTER TABLE runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0`);
  }
  const keyColumns = conn.pragma("table_info(workspace_keys)") as Array<{ name: string }>;
  if (!keyColumns.some((column) => column.name === "role")) {
    conn.exec(`ALTER TABLE workspace_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'developer'`);
  }
  const regressionCaseColumns = conn.pragma("table_info(regression_cases)") as Array<{ name: string }>;
  if (!regressionCaseColumns.some((column) => column.name === "evaluator_json")) {
    conn.exec(`ALTER TABLE regression_cases ADD COLUMN evaluator_json TEXT`);
  }
  if (!regressionCaseColumns.some((column) => column.name === "suite_id")) {
    conn.exec(`ALTER TABLE regression_cases ADD COLUMN suite_id TEXT`);
  }
  const suiteColumns = conn.pragma("table_info(eval_suites)") as Array<{ name: string }>;
  if (!suiteColumns.some((column) => column.name === "agent_id")) {
    conn.exec(`ALTER TABLE eval_suites ADD COLUMN agent_id TEXT`);
  }
  _db = conn;
  return conn;
}

export function getSetting(key: string): string | null {
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    db().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    return;
  }
  db()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export type RunStatus = "queued" | "running" | "done" | "error";

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface WorkspaceKeyRecord {
  id: string;
  workspaceId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  role: "owner" | "admin" | "developer" | "viewer";
  createdAt: number;
}

export interface AuditEventRecord {
  id: string;
  workspaceId: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  ipHash: string | null;
  metadata: unknown;
  createdAt: number;
}

export function insertAuditEvent(event: AuditEventRecord): void {
  db().prepare(`INSERT INTO audit_events (id, workspace_id, actor_id, actor_type, action, resource_type, resource_id, request_id, ip_hash, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    event.id, event.workspaceId, event.actorId, event.actorType, event.action, event.resourceType,
    event.resourceId, event.requestId, event.ipHash, serializeJson(event.metadata), event.createdAt,
  );
}

export interface TraceRecord {
  workspaceId: string;
  eventId: string;
  traceId: string;
  agentId: string;
  deployment: string | null;
  version: string | null;
  parentId: string | null;
  kind: string;
  input: unknown | null;
  output: unknown | null;
  toolName: string | null;
  toolArguments: unknown | null;
  toolResult: unknown | null;
  latencyMs: number | null;
  status: string | null;
  assertion: unknown | null;
  occurredAt: number;
  metadata: Record<string, string> | null;
}

export interface TraceStatsRecord {
  total: number;
  last24h: number;
  errors: number;
  failedAssertions: number;
  toolCalls: number;
}

export type RegressionCaseStatus = "pass" | "fail" | "error";

export type RegressionGateStatus = "running" | "pass" | "fail" | "error";

export interface RegressionCaseRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  sourceTraceId: string;
  suiteId: string | null;
  name: string;
  inputText: string;
  assertionName: string;
  assertionDetail: string | null;
  evaluator: EvaluatorDefinition | null;
  expectedPass: boolean;
  lastStatus: RegressionCaseStatus | null;
  lastPassed: boolean | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RegressionGateRunRecord {
  id: string;
  workspaceId: string;
  version: string;
  baselineVersion: string | null;
  status: RegressionGateStatus;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  regressions: number;
  createdAt: number;
  completedAt: number | null;
}

export interface RegressionGateCaseResultRecord {
  gateRunId: string;
  workspaceId: string;
  caseId: string;
  agentId: string;
  status: RegressionCaseStatus;
  passed: boolean | null;
  baselineStatus: RegressionCaseStatus | null;
  regression: boolean;
  latencyMs: number | null;
  error: string | null;
  createdAt: number;
}

export function getWorkspace(id: string): WorkspaceRecord | null {
  const row = db().prepare(`SELECT id, name, created_at FROM workspaces WHERE id = ?`).get(id) as
    | { id: string; name: string; created_at: number }
    | undefined;
  return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
}

export function insertWorkspace(workspace: WorkspaceRecord): void {
  db().prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`).run(
    workspace.id,
    workspace.name,
    workspace.createdAt,
  );
}

export function getWorkspaceKeyByPrefix(prefix: string): WorkspaceKeyRecord | null {
  const row = db()
    .prepare(
      `SELECT id, workspace_id, name, prefix, token_hash, role, created_at
       FROM workspace_keys WHERE prefix = ?`,
    )
    .get(prefix) as
    | {
        id: string;
        workspace_id: string;
        name: string;
        prefix: string;
        token_hash: string;
        role: "owner" | "admin" | "developer" | "viewer";
        created_at: number;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        prefix: row.prefix,
        tokenHash: row.token_hash,
        role: row.role,
        createdAt: row.created_at,
      }
    : null;
}

export function insertWorkspaceKey(key: WorkspaceKeyRecord): void {
  db()
    .prepare(
      `INSERT INTO workspace_keys
       (id, workspace_id, name, prefix, token_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(key.id, key.workspaceId, key.name, key.prefix, key.tokenHash, key.role, key.createdAt);
}

export function insertTrace(trace: TraceRecord): boolean {
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO traces
       (workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id,
        kind, input_json, output_json, tool_name, tool_arguments_json, tool_result_json,
        latency_ms, status, assertion_json, occurred_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      trace.workspaceId,
      trace.eventId,
      trace.traceId,
      trace.agentId,
      trace.deployment,
      trace.version,
      trace.parentId,
      trace.kind,
      serializeJson(trace.input),
      serializeJson(trace.output),
      trace.toolName,
      serializeJson(trace.toolArguments),
      serializeJson(trace.toolResult),
      trace.latencyMs,
      trace.status,
      serializeJson(trace.assertion),
      trace.occurredAt,
      serializeJson(trace.metadata),
    );
  if (result.changes === 1) {
    db().prepare(`UPDATE agents SET last_trace_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
      trace.occurredAt,
      Date.now(),
      trace.agentId,
      trace.workspaceId,
    );
    return true;
  }
  return false;
}

export function listTraces(workspaceId: string, agentId: string, limit: number): TraceRecord[] {
  const rows = db()
    .prepare(
      `SELECT workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id,
        kind, input_json, output_json, tool_name, tool_arguments_json, tool_result_json,
        latency_ms, status, assertion_json, occurred_at, metadata_json
       FROM traces WHERE workspace_id = ? AND agent_id = ?
       ORDER BY occurred_at DESC LIMIT ?`,
    )
    .all(workspaceId, agentId, limit) as RawTraceRow[];
  return rows.map(hydrateTrace);
}

export function listWorkspaceTraces(
  workspaceId: string,
  limit: number,
  agentId?: string,
): TraceRecord[] {
  const rows = (agentId
    ? db()
        .prepare(
          `SELECT workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id,
            kind, input_json, output_json, tool_name, tool_arguments_json, tool_result_json,
            latency_ms, status, assertion_json, occurred_at, metadata_json
           FROM traces WHERE workspace_id = ? AND agent_id = ?
           ORDER BY occurred_at DESC LIMIT ?`,
        )
        .all(workspaceId, agentId, limit)
    : db()
        .prepare(
          `SELECT workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id,
            kind, input_json, output_json, tool_name, tool_arguments_json, tool_result_json,
            latency_ms, status, assertion_json, occurred_at, metadata_json
           FROM traces WHERE workspace_id = ?
           ORDER BY occurred_at DESC LIMIT ?`,
        )
        .all(workspaceId, limit)) as RawTraceRow[];
  return rows.map(hydrateTrace);
}

export function getTraceStats(workspaceId: string, now = Date.now()): TraceStatsRecord {
  const row = db()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS last24h,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
         SUM(CASE WHEN kind = 'assertion' AND json_extract(assertion_json, '$.passed') = 0 THEN 1 ELSE 0 END) AS failed_assertions,
         SUM(CASE WHEN kind = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls
       FROM traces WHERE workspace_id = ?`,
    )
    .get(now - 86_400_000, workspaceId) as
    | {
        total: number;
        last24h: number | null;
        errors: number | null;
        failed_assertions: number | null;
        tool_calls: number | null;
      };
  return {
    total: row.total,
    last24h: row.last24h ?? 0,
    errors: row.errors ?? 0,
    failedAssertions: row.failed_assertions ?? 0,
    toolCalls: row.tool_calls ?? 0,
  };
}

export function getTrace(workspaceId: string, agentId: string, traceId: string): TraceRecord | null {
  const row = db()
    .prepare(
      `SELECT workspace_id, event_id, trace_id, agent_id, deployment, version, parent_id,
        kind, input_json, output_json, tool_name, tool_arguments_json, tool_result_json,
        latency_ms, status, assertion_json, occurred_at, metadata_json
       FROM traces WHERE workspace_id = ? AND agent_id = ? AND trace_id = ?
       ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get(workspaceId, agentId, traceId) as RawTraceRow | undefined;
  return row ? hydrateTrace(row) : null;
}

export function insertRegressionCase(input: RegressionCaseRecord): boolean {
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO regression_cases
       (id, workspace_id, agent_id, source_trace_id, suite_id, name, input_json, assertion_name,
        assertion_detail, evaluator_json, expected_pass, last_status, last_passed, last_latency_ms,
        last_error, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.workspaceId,
      input.agentId,
      input.sourceTraceId,
      input.suiteId,
      input.name,
      input.inputText,
      input.assertionName,
      input.assertionDetail,
      serializeJson(input.evaluator),
      input.expectedPass ? 1 : 0,
      input.lastStatus,
      input.lastPassed === null ? null : input.lastPassed ? 1 : 0,
      input.lastLatencyMs,
      input.lastError,
      input.lastRunAt,
      input.createdAt,
      input.updatedAt,
    );
  return result.changes === 1;
}

export function getRegressionCaseBySource(
  workspaceId: string,
  agentId: string,
  sourceTraceId: string,
): RegressionCaseRecord | null {
  const row = db()
    .prepare(`SELECT * FROM regression_cases WHERE workspace_id = ? AND agent_id = ? AND source_trace_id = ?`)
    .get(workspaceId, agentId, sourceTraceId) as RawRegressionCaseRow | undefined;
  return row ? hydrateRegressionCase(row) : null;
}

export function getRegressionCase(workspaceId: string, id: string): RegressionCaseRecord | null {
  const row = db()
    .prepare(`SELECT * FROM regression_cases WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id) as RawRegressionCaseRow | undefined;
  return row ? hydrateRegressionCase(row) : null;
}

export function listRegressionCases(workspaceId: string): RegressionCaseRecord[] {
  const rows = db()
    .prepare(`SELECT * FROM regression_cases WHERE workspace_id = ? ORDER BY updated_at DESC`)
    .all(workspaceId) as RawRegressionCaseRow[];
  return rows.map(hydrateRegressionCase);
}

export function updateRegressionCaseReplay(
  workspaceId: string,
  id: string,
  input: {
    status: RegressionCaseStatus;
    passed: boolean | null;
    latencyMs: number | null;
    error: string | null;
    runAt: number;
  },
): boolean {
  const result = db()
    .prepare(
      `UPDATE regression_cases
       SET last_status = ?, last_passed = ?, last_latency_ms = ?, last_error = ?,
           last_run_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
    )
    .run(
      input.status,
      input.passed === null ? null : input.passed ? 1 : 0,
      input.latencyMs,
      input.error,
      input.runAt,
      input.runAt,
      workspaceId,
      id,
    );
  return result.changes === 1;
}

export function insertRegressionGateRun(input: RegressionGateRunRecord): void {
  db()
    .prepare(
      `INSERT INTO regression_gate_runs
       (id, workspace_id, version, baseline_version, status, total, passed, failed,
        errors, regressions, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.workspaceId,
      input.version,
      input.baselineVersion,
      input.status,
      input.total,
      input.passed,
      input.failed,
      input.errors,
      input.regressions,
      input.createdAt,
      input.completedAt,
    );
}

export function getLatestCompletedRegressionGate(workspaceId: string): RegressionGateRunRecord | null {
  const row = db()
    .prepare(
      `SELECT * FROM regression_gate_runs
       WHERE workspace_id = ? AND status IN ('pass', 'fail', 'error')
       ORDER BY completed_at DESC, created_at DESC LIMIT 1`,
    )
    .get(workspaceId) as RawRegressionGateRunRow | undefined;
  return row ? hydrateRegressionGateRun(row) : null;
}

export function listRegressionGateRuns(workspaceId: string, limit = 20): RegressionGateRunRecord[] {
  const rows = db()
    .prepare(
      `SELECT * FROM regression_gate_runs WHERE workspace_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(workspaceId, Math.min(100, Math.max(1, Math.floor(limit)))) as RawRegressionGateRunRow[];
  return rows.map(hydrateRegressionGateRun);
}

export function insertRegressionGateCaseResult(input: RegressionGateCaseResultRecord): void {
  db()
    .prepare(
      `INSERT INTO regression_gate_case_results
       (gate_run_id, workspace_id, case_id, agent_id, status, passed, baseline_status,
        regression, latency_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.gateRunId,
      input.workspaceId,
      input.caseId,
      input.agentId,
      input.status,
      input.passed === null ? null : input.passed ? 1 : 0,
      input.baselineStatus,
      input.regression ? 1 : 0,
      input.latencyMs,
      input.error,
      input.createdAt,
    );
}

export function getLatestRegressionGateCaseResult(
  workspaceId: string,
  caseId: string,
): RegressionGateCaseResultRecord | null {
  const row = db()
    .prepare(
      `SELECT * FROM regression_gate_case_results
       WHERE workspace_id = ? AND case_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(workspaceId, caseId) as RawRegressionGateCaseResultRow | undefined;
  return row ? hydrateRegressionGateCaseResult(row) : null;
}

export function listRegressionGateCaseResults(
  workspaceId: string,
  gateRunId: string,
): RegressionGateCaseResultRecord[] {
  const rows = db()
    .prepare(
      `SELECT * FROM regression_gate_case_results
       WHERE workspace_id = ? AND gate_run_id = ? ORDER BY case_id ASC`,
    )
    .all(workspaceId, gateRunId) as RawRegressionGateCaseResultRow[];
  return rows.map(hydrateRegressionGateCaseResult);
}

export function completeRegressionGateRun(
  workspaceId: string,
  id: string,
  input: Pick<RegressionGateRunRecord, "status" | "total" | "passed" | "failed" | "errors" | "regressions" | "completedAt">,
): boolean {
  const result = db()
    .prepare(
      `UPDATE regression_gate_runs
       SET status = ?, total = ?, passed = ?, failed = ?, errors = ?, regressions = ?, completed_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'running'`,
    )
    .run(
      input.status,
      input.total,
      input.passed,
      input.failed,
      input.errors,
      input.regressions,
      input.completedAt,
      workspaceId,
      id,
    );
  return result.changes === 1;
}

export function insertDatasetVersion(input: DatasetVersionRecord, items: DatasetItem[]): "inserted" | "existing" | "conflict" {
  const existing = db().prepare(`SELECT id, checksum FROM eval_dataset_versions WHERE workspace_id = ? AND dataset_id = ? AND version = ?`).get(input.workspaceId, input.datasetId, input.version) as { id: string; checksum: string } | undefined;
  if (existing) return existing.checksum === input.checksum ? "existing" : "conflict";
  const transaction = db().transaction(() => {
    db().prepare(`INSERT INTO eval_datasets (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, name) DO NOTHING`).run(input.datasetId, input.workspaceId, input.name, input.createdAt);
    db().prepare(`INSERT INTO eval_dataset_versions (id, dataset_id, workspace_id, version, checksum, item_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.datasetId, input.workspaceId, input.version, input.checksum, input.itemCount, input.createdAt);
    const statement = db().prepare(`INSERT INTO eval_dataset_items (id, version_id, workspace_id, position, input_json, expected_output_json, evaluator_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) statement.run(item.id, input.id, input.workspaceId, item.position, JSON.stringify(item.input), item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput), item.evaluator === undefined ? null : JSON.stringify(item.evaluator), item.metadata === undefined ? null : JSON.stringify(item.metadata));
  });
  try {
    transaction();
    return "inserted";
  } catch (error: unknown) {
    if (error instanceof Error && /UNIQUE constraint failed: eval_dataset_versions/.test(error.message)) return "conflict";
    throw error;
  }
}

export function listDatasetVersions(workspaceId: string): DatasetVersionRecord[] {
  const rows = db().prepare(`SELECT v.id, v.dataset_id, d.name, v.workspace_id, v.version, v.checksum, v.item_count, v.created_at FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.workspace_id = ? ORDER BY d.name ASC, v.created_at DESC`).all(workspaceId) as RawDatasetVersionRow[];
  return rows.map(datasetVersionFromRow);
}

export function getDatasetVersion(workspaceId: string, id: string): DatasetVersionRecord | null {
  const row = db().prepare(`SELECT v.id, v.dataset_id, d.name, v.workspace_id, v.version, v.checksum, v.item_count, v.created_at FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.workspace_id = ? AND v.id = ?`).get(workspaceId, id) as RawDatasetVersionRow | undefined;
  if (!row) return null;
  const items = db().prepare(`SELECT id, position, input_json, expected_output_json, evaluator_json, metadata_json FROM eval_dataset_items WHERE workspace_id = ? AND version_id = ? ORDER BY position ASC`).all(workspaceId, id) as RawDatasetItemRow[];
  return { ...datasetVersionFromRow(row), items: items.map(datasetItemFromRow) };
}

export function insertSuite(input: SuiteRecord): "inserted" | "existing" | "conflict" {
  const existing = db().prepare(`SELECT id, dataset_version_id, agent_id, max_cases, concurrency FROM eval_suites WHERE workspace_id = ? AND name = ? AND version = ?`).get(input.workspaceId, input.name, input.version) as { id: string; dataset_version_id: string; agent_id: string | null; max_cases: number | null; concurrency: number | null } | undefined;
  if (existing) return existing.dataset_version_id === input.datasetVersionId && existing.agent_id === input.agentId && existing.max_cases === input.maxCases && existing.concurrency === input.concurrency ? "existing" : "conflict";
  try {
    db().prepare(`INSERT INTO eval_suites (id, workspace_id, name, version, dataset_version_id, agent_id, max_cases, concurrency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.workspaceId, input.name, input.version, input.datasetVersionId, input.agentId, input.maxCases, input.concurrency, input.createdAt);
    return "inserted";
  } catch (error: unknown) {
    if (error instanceof Error && /FOREIGN KEY constraint failed/.test(error.message)) return "conflict";
    throw error;
  }
}

export function listSuites(workspaceId: string): SuiteRecord[] {
  const rows = db().prepare(`SELECT s.id, s.workspace_id, s.name, s.version, s.dataset_version_id, s.agent_id, d.checksum, s.max_cases, s.concurrency, s.created_at FROM eval_suites s JOIN eval_dataset_versions d ON d.id = s.dataset_version_id WHERE s.workspace_id = ? ORDER BY s.name ASC, s.version DESC`).all(workspaceId) as RawSuiteRow[];
  return rows.map(suiteFromRow);
}

export function getSuite(workspaceId: string, id: string): SuiteRecord | null {
  const row = db().prepare(`SELECT s.id, s.workspace_id, s.name, s.version, s.dataset_version_id, s.agent_id, d.checksum, s.max_cases, s.concurrency, s.created_at FROM eval_suites s JOIN eval_dataset_versions d ON d.id = s.dataset_version_id WHERE s.workspace_id = ? AND s.id = ?`).get(workspaceId, id) as RawSuiteRow | undefined;
  return row ? suiteFromRow(row) : null;
}

interface RawTraceRow {
  workspace_id: string;
  event_id: string;
  trace_id: string;
  agent_id: string;
  deployment: string | null;
  version: string | null;
  parent_id: string | null;
  kind: string;
  input_json: string | null;
  output_json: string | null;
  tool_name: string | null;
  tool_arguments_json: string | null;
  tool_result_json: string | null;
  latency_ms: number | null;
  status: string | null;
  assertion_json: string | null;
  occurred_at: number;
  metadata_json: string | null;
}

interface RawRegressionCaseRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  source_trace_id: string;
  suite_id: string | null;
  name: string;
  input_json: string;
  assertion_name: string;
  assertion_detail: string | null;
  evaluator_json: string | null;
  expected_pass: number;
  last_status: string | null;
  last_passed: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RawRegressionGateRunRow {
  id: string;
  workspace_id: string;
  version: string;
  baseline_version: string | null;
  status: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  regressions: number;
  created_at: number;
  completed_at: number | null;
}

interface RawRegressionGateCaseResultRow {
  gate_run_id: string;
  workspace_id: string;
  case_id: string;
  agent_id: string;
  status: string;
  passed: number | null;
  baseline_status: string | null;
  regression: number;
  latency_ms: number | null;
  error: string | null;
  created_at: number;
}

interface RawDatasetVersionRow {
  id: string;
  dataset_id: string;
  name: string;
  workspace_id: string;
  version: string;
  checksum: string;
  item_count: number;
  created_at: number;
}

interface RawDatasetItemRow {
  id: string;
  position: number;
  input_json: string;
  expected_output_json: string | null;
  evaluator_json: string | null;
  metadata_json: string | null;
}

interface RawSuiteRow {
  id: string;
  workspace_id: string;
  name: string;
  version: string;
  dataset_version_id: string;
  agent_id: string | null;
  checksum: string;
  max_cases: number | null;
  concurrency: number | null;
  created_at: number;
}

function datasetVersionFromRow(row: RawDatasetVersionRow): DatasetVersionRecord {
  return { id: row.id, datasetId: row.dataset_id, workspaceId: row.workspace_id, name: row.name, version: row.version, checksum: row.checksum, itemCount: row.item_count, createdAt: row.created_at };
}

function datasetItemFromRow(row: RawDatasetItemRow): DatasetItem {
  return { id: row.id, position: row.position, input: parseJson(row.input_json), expectedOutput: row.expected_output_json ? parseJson(row.expected_output_json) : undefined, evaluator: row.evaluator_json ? parseEvaluator(row.evaluator_json) ?? undefined : undefined, metadata: row.metadata_json ? parseJson(row.metadata_json) as Record<string, string> : undefined };
}

function suiteFromRow(row: RawSuiteRow): SuiteRecord {
  return { id: row.id, workspaceId: row.workspace_id, name: row.name, version: row.version, datasetVersionId: row.dataset_version_id, datasetChecksum: row.checksum, agentId: row.agent_id, maxCases: row.max_cases, concurrency: row.concurrency, createdAt: row.created_at };
}

function hydrateRegressionCase(row: RawRegressionCaseRow): RegressionCaseRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    sourceTraceId: row.source_trace_id,
    suiteId: row.suite_id,
    name: row.name,
    inputText: row.input_json,
    assertionName: row.assertion_name,
    assertionDetail: row.assertion_detail,
    evaluator: parseEvaluator(row.evaluator_json),
    expectedPass: row.expected_pass === 1,
    lastStatus: row.last_status as RegressionCaseStatus | null,
    lastPassed: row.last_passed === null ? null : row.last_passed === 1,
    lastLatencyMs: row.last_latency_ms,
    lastError: row.last_error,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydrateRegressionGateRun(row: RawRegressionGateRunRow): RegressionGateRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    version: row.version,
    baselineVersion: row.baseline_version,
    status: row.status as RegressionGateStatus,
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    errors: row.errors,
    regressions: row.regressions,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function hydrateRegressionGateCaseResult(row: RawRegressionGateCaseResultRow): RegressionGateCaseResultRecord {
  return {
    gateRunId: row.gate_run_id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    agentId: row.agent_id,
    status: row.status as RegressionCaseStatus,
    passed: row.passed === null ? null : row.passed === 1,
    baselineStatus: row.baseline_status as RegressionCaseStatus | null,
    regression: row.regression === 1,
    latencyMs: row.latency_ms,
    error: row.error,
    createdAt: row.created_at,
  };
}

function hydrateTrace(row: RawTraceRow): TraceRecord {
  return {
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    traceId: row.trace_id,
    agentId: row.agent_id,
    deployment: row.deployment,
    version: row.version,
    parentId: row.parent_id,
    kind: row.kind,
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    toolName: row.tool_name,
    toolArguments: parseJson(row.tool_arguments_json),
    toolResult: parseJson(row.tool_result_json),
    latencyMs: row.latency_ms,
    status: row.status,
    assertion: parseJson(row.assertion_json),
    occurredAt: row.occurred_at,
    metadata: parseJson(row.metadata_json) as Record<string, string> | null,
  };
}

function serializeJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseEvaluator(value: string | null): EvaluatorDefinition | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    if (parsed.type === "model") return { type: "model" };
    if (parsed.type === "contains" && typeof parsed.value === "string") {
      return { type: "contains", value: parsed.value, caseSensitive: parsed.caseSensitive === true };
    }
    if (parsed.type === "regex" && typeof parsed.pattern === "string") {
      return { type: "regex", pattern: parsed.pattern, flags: typeof parsed.flags === "string" ? parsed.flags : "" };
    }
    if (parsed.type === "exact_json" && "value" in parsed) return { type: "exact_json", value: parsed.value };
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string | null): unknown | null {
  return value === null ? null : JSON.parse(value) as unknown;
}

export type AgentProtocol = "openai" | "coval";
export type AgentAuthType = "none" | "bearer" | "header";

export interface AgentRow {
  id: string;
  workspaceId: string;
  name: string;
  clientName: string | null;
  endpointUrl: string;
  protocol: AgentProtocol;
  authType: AgentAuthType;
  authToken: string | null;
  authHeaderName: string | null;
  systemPrompt: string;
  agentFamily: "anthropic" | "openai" | "unknown";
  mode: "auto" | EvalMode | null;
  tools: ToolDefinition[];
  active: boolean;
  source: "manual" | "sdk" | "mcp" | "ci";
  externalId: string | null;
  lastTraceAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RunRow {
  id: string;
  workspaceId: string;
  agentId: string | null;
  agentName: string;
  clientName: string | null;
  endpointUrl: string;
  status: RunStatus;
  progress: RunProgress | null;
  report: RunReport | null;
  error: string | null;
  createdAt: number;
}

interface RawRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  agent_name: string;
  client_name: string | null;
  endpoint_url: string;
  status: string;
  progress_json: string | null;
  report_json: string | null;
  error: string | null;
  created_at: number;
}

function hydrate(row: RawRow): RunRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    clientName: row.client_name,
    endpointUrl: row.endpoint_url,
    status: row.status as RunStatus,
    progress: row.progress_json ? (JSON.parse(row.progress_json) as RunProgress) : null,
    report: row.report_json ? (JSON.parse(row.report_json) as RunReport) : null,
    error: row.error,
    createdAt: row.created_at,
  };
}

export function createRun(input: {
  id: string;
  workspaceId?: string;
  agentId?: string;
  agentName: string;
  clientName: string | null;
  endpointUrl: string;
  createdAt: number;
  status?: RunStatus;
}): void {
  db().prepare(
    `INSERT INTO runs (id, workspace_id, agent_id, agent_name, client_name, endpoint_url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.workspaceId ?? "workspace_local",
    input.agentId ?? null,
    input.agentName,
    input.clientName,
    input.endpointUrl,
    input.status ?? "running",
    input.createdAt,
  );
}

export function markRunRunning(id: string): void {
  db().prepare(`UPDATE runs SET status = 'running' WHERE id = ?`).run(id);
}

interface RawAgentRow {
  id: string;
  workspace_id: string;
  name: string;
  client_name: string | null;
  endpoint_url: string;
  protocol: string;
  auth_type: string;
  auth_token: string | null;
  auth_header_name: string | null;
  system_prompt: string;
  agent_family: string;
  mode: string | null;
  tools_json: string;
  active: number;
  source: string;
  external_id: string | null;
  last_trace_at: number | null;
  created_at: number;
  updated_at: number;
}

function hydrateAgent(row: RawAgentRow): AgentRow {
  const tools = JSON.parse(row.tools_json) as ToolDefinition[];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    clientName: row.client_name,
    endpointUrl: row.endpoint_url,
    protocol: row.protocol as AgentProtocol,
    authType: row.auth_type as AgentAuthType,
    authToken: row.auth_token,
    authHeaderName: row.auth_header_name,
    systemPrompt: row.system_prompt,
    agentFamily: row.agent_family as AgentRow["agentFamily"],
    mode: row.mode as AgentRow["mode"],
    tools,
    active: row.active === 1,
    source: row.source as AgentRow["source"],
    externalId: row.external_id,
    lastTraceAt: row.last_trace_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertAgent(input: AgentRow): void {
  db().prepare(
    `INSERT INTO agents
      (id, workspace_id, name, client_name, endpoint_url, protocol, auth_type, auth_token,
       auth_header_name, system_prompt, agent_family, mode, tools_json, active,
       source, external_id, last_trace_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.workspaceId,
    input.name,
    input.clientName,
    input.endpointUrl,
    input.protocol,
    input.authType,
    input.authToken,
    input.authHeaderName,
    input.systemPrompt,
    input.agentFamily,
    input.mode,
    JSON.stringify(input.tools),
    input.active ? 1 : 0,
    input.source,
    input.externalId,
    input.lastTraceAt,
    input.createdAt,
    input.updatedAt,
  );
}

export function getAgent(id: string, workspaceId?: string): AgentRow | null {
  const row = (workspaceId
    ? db().prepare(`SELECT * FROM agents WHERE id = ? AND workspace_id = ?`).get(id, workspaceId)
    : db().prepare(`SELECT * FROM agents WHERE id = ?`).get(id)) as
    | RawAgentRow
    | undefined;
  return row ? hydrateAgent(row) : null;
}

export function getAgentByExternalId(workspaceId: string, externalId: string): AgentRow | null {
  const row = db()
    .prepare(`SELECT * FROM agents WHERE workspace_id = ? AND external_id = ?`)
    .get(workspaceId, externalId) as RawAgentRow | undefined;
  return row ? hydrateAgent(row) : null;
}

export function listAgents(workspaceId?: string): AgentRow[] {
  const rows = (workspaceId
    ? db()
        .prepare(`SELECT * FROM agents WHERE workspace_id = ? ORDER BY active DESC, updated_at DESC`)
        .all(workspaceId)
    : db().prepare(`SELECT * FROM agents ORDER BY active DESC, updated_at DESC`).all()) as RawAgentRow[];
  return rows.map(hydrateAgent);
}

export function setAgentActive(id: string, active: boolean): boolean {
  const result = db()
    .prepare(`UPDATE agents SET active = ?, updated_at = ? WHERE id = ?`)
    .run(active ? 1 : 0, Date.now(), id);
  return result.changes === 1;
}

export function updateProgress(id: string, progress: RunProgress): void {
  db().prepare(`UPDATE runs SET progress_json = ? WHERE id = ?`).run(
    JSON.stringify(progress),
    id,
  );
}

export function completeRun(id: string, report: RunReport): void {
  db().prepare(`UPDATE runs SET status = 'done', report_json = ? WHERE id = ?`).run(
    JSON.stringify(report),
    id,
  );
}

export function failRun(id: string, error: string): void {
  db().prepare(`UPDATE runs SET status = 'error', error = ? WHERE id = ?`).run(error, id);
}

export function getRun(id: string, workspaceId?: string): RunRow | null {
  const row = (workspaceId
    ? db().prepare(`SELECT * FROM runs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId)
    : db().prepare(`SELECT * FROM runs WHERE id = ?`).get(id)) as
    | RawRow
    | undefined;
  return row ? hydrate(row) : null;
}

export function listRuns(workspaceId?: string): RunRow[] {
  const rows = (workspaceId
    ? db()
        .prepare(`SELECT * FROM runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`)
        .all(workspaceId)
    : db().prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT 50`).all()) as RawRow[];
  return rows.map(hydrate);
}
