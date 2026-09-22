import { queryShared, type SharedRow } from "./shared-db";
import type { DatasetItem, DatasetVersionRecord } from "./dataset-store";

export async function createSharedDatasetVersion(record: DatasetVersionRecord, items: DatasetItem[]): Promise<{ ok: true; value: { record: DatasetVersionRecord; created: boolean } } | { ok: false; error: "conflict" | "storage"; message: string }> {
  const existing = await queryShared<{ id: string; checksum: string }>("SELECT id, checksum FROM eval_dataset_versions WHERE workspace_id = $1 AND dataset_id = $2 AND version = $3", [record.workspaceId, record.datasetId, record.version]);
  if (!existing.ok) return { ok: false, error: "storage", message: existing.error };
  const found = existing.rows[0];
  let versionId = record.id;
  let created = true;
  if (found) {
    if (found.checksum !== record.checksum) return { ok: false, error: "conflict", message: "dataset version already exists with a different checksum" };
    const stored = await getSharedDatasetVersion(record.workspaceId, found.id);
    if (!stored) return { ok: false, error: "storage", message: "dataset version could not be read" };
    versionId = found.id;
    created = false;
    if (stored.itemCount === stored.items?.length) return { ok: true, value: { record: stored, created: false } };
  } else {
    const dataset = await queryShared(`INSERT INTO eval_datasets (id, workspace_id, name, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, name) DO NOTHING`, [record.datasetId, record.workspaceId, record.name, record.createdAt]);
    if (!dataset.ok) return { ok: false, error: "storage", message: dataset.error };
    const version = await queryShared(`INSERT INTO eval_dataset_versions (id, dataset_id, workspace_id, version, checksum, item_count, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (workspace_id, dataset_id, version) DO NOTHING RETURNING id`, [record.id, record.datasetId, record.workspaceId, record.version, record.checksum, record.itemCount, record.createdAt]);
    if (!version.ok) return { ok: false, error: "storage", message: version.error };
    if (version.rows.length === 1) {
      versionId = record.id;
    } else {
      const existingVersion = await queryShared<{ id: string; checksum: string }>("SELECT id, checksum FROM eval_dataset_versions WHERE workspace_id = $1 AND dataset_id = $2 AND version = $3", [record.workspaceId, record.datasetId, record.version]);
      if (!existingVersion.ok || !existingVersion.rows[0]) return { ok: false, error: "storage", message: "dataset version could not be read after concurrent insert" };
      versionId = existingVersion.rows[0].id;
      created = false;
      if (existingVersion.rows[0].checksum !== record.checksum) return { ok: false, error: "conflict", message: "dataset version already exists with a different checksum" };
    }
  }
  for (const item of items) {
    const inserted = await queryShared(`INSERT INTO eval_dataset_items (id, version_id, workspace_id, position, input_json, expected_output_json, evaluator_json, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (version_id, position) DO NOTHING`, [item.id, versionId, record.workspaceId, item.position, JSON.stringify(item.input), item.expectedOutput === undefined ? null : JSON.stringify(item.expectedOutput), item.evaluator === undefined ? null : JSON.stringify(item.evaluator), item.metadata === undefined ? null : JSON.stringify(item.metadata)]);
    if (!inserted.ok) return { ok: false, error: "storage", message: inserted.error };
  }
  const stored = await getSharedDatasetVersion(record.workspaceId, versionId);
  if (!stored) return { ok: false, error: "storage", message: "dataset version could not be read after insert" };
  return stored.itemCount === stored.items?.length ? { ok: true, value: { record: stored, created } } : { ok: false, error: "storage", message: "dataset version upload is incomplete" };
}

export async function listSharedDatasetVersions(workspaceId: string): Promise<DatasetVersionRecord[]> {
  const result = await queryShared<SharedDatasetVersionRow>(`SELECT v.id, v.dataset_id, d.name, v.workspace_id, v.version, v.checksum, v.item_count, v.created_at FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.workspace_id = $1 ORDER BY d.name ASC, v.created_at DESC`, [workspaceId]);
  return result.ok ? result.rows.map(versionFromRow) : [];
}

export async function getSharedDatasetVersion(workspaceId: string, id: string): Promise<DatasetVersionRecord | null> {
  const result = await queryShared<SharedDatasetVersionRow>(`SELECT v.id, v.dataset_id, d.name, v.workspace_id, v.version, v.checksum, v.item_count, v.created_at FROM eval_dataset_versions v JOIN eval_datasets d ON d.id = v.dataset_id WHERE v.workspace_id = $1 AND v.id = $2`, [workspaceId, id]);
  const row = result.ok ? result.rows[0] : undefined;
  if (!row) return null;
  const items = await queryShared<SharedDatasetItemRow>(`SELECT id, position, input_json, expected_output_json, evaluator_json, metadata_json FROM eval_dataset_items WHERE workspace_id = $1 AND version_id = $2 ORDER BY position ASC`, [workspaceId, id]);
  return { ...versionFromRow(row), items: items.ok ? items.rows.map(itemFromRow) : [] };
}

interface SharedDatasetVersionRow extends SharedRow {
  id: string;
  dataset_id: string;
  name: string;
  workspace_id: string;
  version: string;
  checksum: string;
  item_count: number;
  created_at: number;
}

interface SharedDatasetItemRow extends SharedRow {
  id: string;
  position: number;
  input_json: string;
  expected_output_json: string | null;
  evaluator_json: string | null;
  metadata_json: string | null;
}

function versionFromRow(row: SharedDatasetVersionRow): DatasetVersionRecord {
  return { id: row.id, datasetId: row.dataset_id, workspaceId: row.workspace_id, name: row.name, version: row.version, checksum: row.checksum, itemCount: Number(row.item_count), createdAt: Number(row.created_at) };
}

function itemFromRow(row: SharedDatasetItemRow): DatasetItem {
  return { id: row.id, position: row.position, input: parseJson(row.input_json), expectedOutput: row.expected_output_json ? parseJson(row.expected_output_json) : undefined, evaluator: parseJson(row.evaluator_json) as DatasetItem["evaluator"], metadata: parseJson(row.metadata_json) as Record<string, string> | undefined };
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}
