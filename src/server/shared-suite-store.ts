import { queryShared, type SharedRow } from "./shared-db";
import type { SuiteRecord } from "./suite-store";

export async function createSharedSuite(record: SuiteRecord): Promise<{ ok: true; value: { record: SuiteRecord; created: boolean } } | { ok: false; error: "conflict" | "storage"; message: string }> {
  const existing = await queryShared<SharedSuiteRow>(`SELECT s.id, s.dataset_version_id, s.agent_id, s.max_cases, s.concurrency, d.checksum FROM eval_suites s JOIN eval_dataset_versions d ON d.id = s.dataset_version_id WHERE s.workspace_id = $1 AND s.name = $2 AND s.version = $3`, [record.workspaceId, record.name, record.version]);
  if (!existing.ok) return { ok: false, error: "storage", message: existing.error };
  const found = existing.rows[0];
  if (found) {
    const same = found.dataset_version_id === record.datasetVersionId && found.agent_id === record.agentId && found.max_cases === record.maxCases && found.concurrency === record.concurrency;
    if (!same) return { ok: false, error: "conflict", message: "suite version already exists with different configuration" };
    const stored = await getSharedSuite(record.workspaceId, found.id);
    return stored ? { ok: true, value: { record: stored, created: false } } : { ok: false, error: "storage", message: "suite could not be read" };
  }
  const result = await queryShared(`INSERT INTO eval_suites (id, workspace_id, name, version, dataset_version_id, agent_id, max_cases, concurrency, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (workspace_id, name, version) DO NOTHING RETURNING id`, [record.id, record.workspaceId, record.name, record.version, record.datasetVersionId, record.agentId, record.maxCases, record.concurrency, record.createdAt]);
  if (!result.ok) return { ok: false, error: "storage", message: result.error };
  if (result.rows.length === 0) {
    const concurrent = await queryShared<SharedSuiteRow>(`SELECT s.id, s.dataset_version_id, s.agent_id, s.max_cases, s.concurrency, d.checksum FROM eval_suites s JOIN eval_dataset_versions d ON d.id = s.dataset_version_id WHERE s.workspace_id = $1 AND s.name = $2 AND s.version = $3`, [record.workspaceId, record.name, record.version]);
    const found = concurrent.ok ? concurrent.rows[0] : undefined;
    if (!found) return { ok: false, error: "storage", message: "suite could not be read after concurrent insert" };
    const same = found.dataset_version_id === record.datasetVersionId && found.agent_id === record.agentId && found.max_cases === record.maxCases && found.concurrency === record.concurrency;
    if (!same) return { ok: false, error: "conflict", message: "suite version already exists with different configuration" };
    const stored = await getSharedSuite(record.workspaceId, found.id);
    return stored ? { ok: true, value: { record: stored, created: false } } : { ok: false, error: "storage", message: "suite could not be read" };
  }
  return { ok: true, value: { record, created: true } };
}

export async function listSharedSuites(workspaceId: string): Promise<SuiteRecord[]> {
  const result = await queryShared<SharedSuiteRow>(`SELECT s.id, s.workspace_id, s.name, s.version, s.dataset_version_id, s.agent_id, d.checksum, s.max_cases, s.concurrency, s.created_at FROM eval_suites s JOIN eval_dataset_versions d ON d.id = s.dataset_version_id WHERE s.workspace_id = $1 ORDER BY s.name ASC, s.version DESC`, [workspaceId]);
  return result.ok ? result.rows.map(fromRow) : [];
}

export async function getSharedSuite(workspaceId: string, id: string): Promise<SuiteRecord | null> {
  const result = await queryShared<SharedSuiteRow>(`SELECT s.id, s.workspace_id, s.name, s.version, s.dataset_version_id, s.agent_id, d.checksum, s.max_cases, s.concurrency, s.created_at FROM eval_suites s JOIN eval_dataset_versions d ON d.id = s.dataset_version_id WHERE s.workspace_id = $1 AND s.id = $2`, [workspaceId, id]);
  const row = result.ok ? result.rows[0] : undefined;
  return row ? fromRow(row) : null;
}

interface SharedSuiteRow extends SharedRow {
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

function fromRow(row: SharedSuiteRow): SuiteRecord {
  return { id: row.id, workspaceId: row.workspace_id, name: row.name, version: row.version, datasetVersionId: row.dataset_version_id, datasetChecksum: row.checksum, agentId: row.agent_id, maxCases: row.max_cases === null ? null : Number(row.max_cases), concurrency: row.concurrency === null ? null : Number(row.concurrency), createdAt: Number(row.created_at) };
}
