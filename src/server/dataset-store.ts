import { createHash, randomUUID } from "node:crypto";
import { getDatasetVersion, insertDatasetVersion, listDatasetVersions as listStoredDatasetVersions } from "./db";
import { sharedDatabaseEnabled } from "./shared-db";
import { createSharedDatasetVersion, getSharedDatasetVersion, listSharedDatasetVersions } from "./shared-dataset-store";
import type { EvaluatorDefinition } from "@/engine/evaluators";

export interface DatasetItemInput {
  input: unknown;
  expectedOutput?: unknown;
  evaluator?: EvaluatorDefinition;
  metadata?: Record<string, string>;
}

export interface DatasetItem extends DatasetItemInput {
  id: string;
  position: number;
}

export interface DatasetVersionRecord {
  id: string;
  datasetId: string;
  workspaceId: string;
  name: string;
  version: string;
  checksum: string;
  itemCount: number;
  createdAt: number;
  items?: DatasetItem[];
}

export type DatasetCreateResult =
  | { ok: true; value: DatasetVersionRecord; created: boolean }
  | { ok: false; error: "conflict" | "storage"; message: string };

export async function createDatasetVersion(workspaceId: string, name: string, version: string, inputs: DatasetItemInput[]): Promise<DatasetCreateResult> {
  const items = inputs.map((input, position) => ({ ...input, id: randomUUID(), position }));
  const checksum = checksumForItems(items);
  const datasetId = stableId(workspaceId, name);
  const record: DatasetVersionRecord = { id: randomUUID(), datasetId, workspaceId, name, version, checksum, itemCount: items.length, createdAt: Date.now() };
  if (sharedDatabaseEnabled()) {
    const result = await createSharedDatasetVersion(record, items);
    if (!result.ok) return result;
    return { ok: true, value: result.value.record, created: result.value.created };
  }
  const result = insertDatasetVersion(record, items);
  if (result === "conflict") return { ok: false, error: "conflict", message: "dataset version already exists with a different checksum" };
  const stored = getDatasetVersion(workspaceId, result === "existing" ? findExistingVersionId(workspaceId, datasetId, version) : record.id);
  if (!stored) return { ok: false, error: "storage", message: "dataset version could not be read after insert" };
  return { ok: true, value: stored, created: result === "inserted" };
}

export async function listDatasetVersions(workspaceId: string): Promise<DatasetVersionRecord[]> {
  return sharedDatabaseEnabled() ? listSharedDatasetVersions(workspaceId) : listStoredDatasetVersions(workspaceId);
}

export async function getDatasetVersionForWorkspace(workspaceId: string, id: string): Promise<DatasetVersionRecord | null> {
  return sharedDatabaseEnabled() ? getSharedDatasetVersion(workspaceId, id) : getDatasetVersion(workspaceId, id);
}

export function checksumForItems(items: DatasetItem[]): string {
  const normalized = items.map((item) => ({ position: item.position, input: item.input, expectedOutput: item.expectedOutput, evaluator: item.evaluator, metadata: item.metadata }));
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

function findExistingVersionId(workspaceId: string, datasetId: string, version: string): string {
  const existing = listStoredDatasetVersions(workspaceId).find((item) => item.datasetId === datasetId && item.version === version);
  return existing?.id ?? "";
}

function stableId(workspaceId: string, name: string): string {
  return `dataset-${createHash("sha256").update(`${workspaceId}:${name}`).digest("hex").slice(0, 32)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
