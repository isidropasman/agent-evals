import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { RunProgress, RunReport } from "@/engine/types";

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
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
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

export type RunStatus = "running" | "done" | "error";

export interface RunRow {
  id: string;
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
  agentName: string;
  clientName: string | null;
  endpointUrl: string;
  createdAt: number;
}): void {
  db().prepare(
    `INSERT INTO runs (id, agent_name, client_name, endpoint_url, status, created_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).run(input.id, input.agentName, input.clientName, input.endpointUrl, input.createdAt);
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
