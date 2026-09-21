import { createHash, randomUUID } from "node:crypto";
import { getDatasetVersion, getSuite, insertRegressionCase, insertSuite, listSuites, type RegressionCaseRecord } from "./db";
import { sharedDatabaseEnabled } from "./shared-db";
import { createSharedSuite, getSharedSuite, listSharedSuites } from "./shared-suite-store";
import { sharedGetAgent, sharedInsertCase } from "./shared-store";
import { getAgent } from "./db";
import type { EvaluatorDefinition } from "@/engine/evaluators";

export interface SuiteRecord {
  id: string;
  workspaceId: string;
  name: string;
  version: string;
  datasetVersionId: string;
  datasetChecksum: string;
  agentId: string | null;
  maxCases: number | null;
  concurrency: number | null;
  createdAt: number;
}

export type SuiteCreateResult =
  | { ok: true; value: SuiteRecord; created: boolean }
  | { ok: false; error: "dataset_not_found" | "agent_not_found" | "conflict" | "storage"; message: string };

export async function createSuite(workspaceId: string, input: { name: string; version: string; datasetVersionId: string; agentId?: string; maxCases?: number; concurrency?: number }): Promise<SuiteCreateResult> {
  const dataset = sharedDatabaseEnabled() ? await import("./shared-dataset-store").then((module) => module.getSharedDatasetVersion(workspaceId, input.datasetVersionId)) : getDatasetVersion(workspaceId, input.datasetVersionId);
  if (!dataset) return { ok: false, error: "dataset_not_found", message: "dataset version not found" };
  if (input.agentId) {
    const agent = sharedDatabaseEnabled() ? await sharedGetAgent(input.agentId, workspaceId) : getAgent(input.agentId, workspaceId);
    if (!agent) return { ok: false, error: "agent_not_found", message: "agent not found" };
  }
  const record: SuiteRecord = { id: randomUUID(), workspaceId, name: input.name, version: input.version, datasetVersionId: input.datasetVersionId, datasetChecksum: dataset.checksum, agentId: input.agentId ?? null, maxCases: input.maxCases ?? null, concurrency: input.concurrency ?? null, createdAt: Date.now() };
  if (sharedDatabaseEnabled()) {
    const result = await createSharedSuite(record);
    if (!result.ok) return result;
    if (!await materializeCases(result.value.record, dataset.items ?? [])) return { ok: false, error: "storage", message: "suite cases could not be materialized" };
    return { ok: true, value: result.value.record, created: result.value.created };
  }
  const result = insertSuite(record);
  if (result === "conflict") return { ok: false, error: "conflict", message: "suite version already exists with different configuration" };
  const stored = getSuite(workspaceId, result === "existing" ? findExistingSuiteId(workspaceId, record.name, record.version) : record.id);
  if (!stored) return { ok: false, error: "storage", message: "suite could not be read after insert" };
  if (!await materializeCases(stored, dataset.items ?? [])) return { ok: false, error: "storage", message: "suite cases could not be materialized" };
  return { ok: true, value: stored, created: result === "inserted" };
}

async function materializeCases(suite: SuiteRecord, items: Array<{ id: string; position: number; input: unknown; expectedOutput?: unknown; evaluator?: EvaluatorDefinition }>): Promise<boolean> {
  if (!suite.agentId) return true;
  const agent = sharedDatabaseEnabled() ? await sharedGetAgent(suite.agentId, suite.workspaceId) : getAgent(suite.agentId, suite.workspaceId);
  if (!agent) return false;
  const selected = suite.maxCases === null ? items : items.slice(0, suite.maxCases);
  for (const item of selected) {
    const evaluator = item.evaluator ?? ("expectedOutput" in item && item.expectedOutput !== undefined ? { type: "exact_json", value: item.expectedOutput } : null);
    const regressionCase: RegressionCaseRecord = {
      id: `dataset-case-${suite.id}-${item.id}`,
      workspaceId: suite.workspaceId,
      agentId: suite.agentId,
      sourceTraceId: `dataset:${suite.datasetVersionId}:${item.position}`,
      suiteId: suite.id,
      name: `${suite.name} · case ${item.position + 1}`,
      inputText: payloadToText(item.input),
      assertionName: evaluator?.type === "model" || !evaluator ? "model judge" : `${evaluator.type} evaluator`,
      assertionDetail: `dataset ${suite.datasetChecksum}`,
      evaluator,
      expectedPass: true,
      lastStatus: null,
      lastPassed: null,
      lastLatencyMs: null,
      lastError: null,
      lastRunAt: null,
      createdAt: suite.createdAt,
      updatedAt: suite.createdAt,
    };
    if (sharedDatabaseEnabled()) {
      const inserted = await sharedInsertCase(regressionCase);
      if (!inserted.ok) return false;
    } else insertRegressionCase(regressionCase);
  }
  return true;
}

function payloadToText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "null";
}

export async function listWorkspaceSuites(workspaceId: string): Promise<SuiteRecord[]> {
  return sharedDatabaseEnabled() ? listSharedSuites(workspaceId) : listSuites(workspaceId);
}

export async function getWorkspaceSuite(workspaceId: string, id: string): Promise<SuiteRecord | null> {
  return sharedDatabaseEnabled() ? getSharedSuite(workspaceId, id) : getSuite(workspaceId, id);
}

function findExistingSuiteId(workspaceId: string, name: string, version: string): string {
  return listSuites(workspaceId).find((suite) => suite.name === name && suite.version === version)?.id ?? "";
}

export function suiteIdFor(name: string, version: string): string {
  return `suite-${createHash("sha256").update(`${name}:${version}`).digest("hex").slice(0, 24)}`;
}
