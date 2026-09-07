import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { EvalMode, RunProgress, RunReport, ToolDefinition } from "@/engine/types";

let _db: Database.Database | null = null;

// Lazy connection: opening at import time would run during `next build`'s
// page-data collection and lock the file across route modules.
function db(): Database.Database {
  if (_db) return _db;
  const dataDir = path.join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const conn = new Database(path.join(dataDir, "gauntlet.db"));
  conn.pragma("journal_mode = WAL");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      agent_name TEXT NOT NULL,
      client_name TEXT,
      endpoint_url TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_json TEXT,
      report_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const runColumns = conn.pragma("table_info(runs)") as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === "agent_id")) {
    conn.exec(`ALTER TABLE runs ADD COLUMN agent_id TEXT`);
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

export type AgentProtocol = "openai" | "coval";
export type AgentAuthType = "none" | "bearer" | "header";

export interface AgentRow {
  id: string;
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
  createdAt: number;
  updatedAt: number;
}

export interface RunRow {
  id: string;
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
  agentId?: string;
  agentName: string;
  clientName: string | null;
  endpointUrl: string;
  createdAt: number;
  status?: RunStatus;
}): void {
  db().prepare(
    `INSERT INTO runs (id, agent_id, agent_name, client_name, endpoint_url, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
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
  created_at: number;
  updated_at: number;
}

function hydrateAgent(row: RawAgentRow): AgentRow {
  const tools = JSON.parse(row.tools_json) as ToolDefinition[];
  return {
    id: row.id,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function insertAgent(input: AgentRow): void {
  db().prepare(
    `INSERT INTO agents
      (id, name, client_name, endpoint_url, protocol, auth_type, auth_token,
       auth_header_name, system_prompt, agent_family, mode, tools_json, active,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
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
    input.createdAt,
    input.updatedAt,
  );
}

export function getAgent(id: string): AgentRow | null {
  const row = db().prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as
    | RawAgentRow
    | undefined;
  return row ? hydrateAgent(row) : null;
}

export function listAgents(): AgentRow[] {
  const rows = db()
    .prepare(`SELECT * FROM agents ORDER BY active DESC, updated_at DESC`)
    .all() as RawAgentRow[];
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

export function getRun(id: string): RunRow | null {
  const row = db().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
    | RawRow
    | undefined;
  return row ? hydrate(row) : null;
}

export function listRuns(): RunRow[] {
  const rows = db()
    .prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT 50`)
    .all() as RawRow[];
  return rows.map(hydrate);
}
