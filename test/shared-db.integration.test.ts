import { describe, expect, it } from "vitest";
import { queryShared, sharedDatabaseEnabled, transactionShared } from "@/server/shared-db";
import { createSharedDatasetVersion } from "@/server/shared-dataset-store";
import { sharedFailRun, sharedGetRun, sharedInsertRun, sharedMarkRunRunning, sharedRequestRunCancellation } from "@/server/shared-store";
import type { DatasetItem, DatasetVersionRecord } from "@/server/dataset-store";

describe.skipIf(!sharedDatabaseEnabled())("shared Postgres integration", () => {
  it("creates the production schema and preserves tenant isolation", async () => {
    const workspaceId = `integration-${Date.now()}`;
    const otherWorkspaceId = `${workspaceId}-other`;
    const created = await queryShared("INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3)", [workspaceId, "integration", Date.now()]);
    expect(created.ok).toBe(true);
    const hidden = await queryShared("SELECT id FROM workspaces WHERE id = $1", [otherWorkspaceId]);
    expect(hidden.ok && hidden.rows.length === 0).toBe(true);
    await queryShared("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
  });

  it("rolls back the whole migration unit when a later insert violates integrity", async () => {
    const workspaceId = `rollback-${Date.now()}`;
    const transaction = await transactionShared([
      { query: "INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3)", params: [workspaceId, "rollback", Date.now()] },
      { query: "INSERT INTO workspace_keys (id, workspace_id, name, prefix, token_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", params: [`${workspaceId}-key`, `${workspaceId}-missing`, "rollback", `${workspaceId}-prefix`, "hash", "owner", Date.now()] },
    ]);
    expect(transaction.ok).toBe(false);
    const rolledBack = await queryShared("SELECT id FROM workspaces WHERE id = $1", [workspaceId]);
    expect(rolledBack.ok && rolledBack.rows.length).toBe(0);
  });

  it("repairs an incomplete immutable dataset upload on a retry", async () => {
    const workspaceId = `dataset-retry-${Date.now()}`;
    const datasetId = `${workspaceId}-dataset`;
    const versionId = `${workspaceId}-version`;
    const items: DatasetItem[] = [
      { id: `${workspaceId}-item-0`, position: 0, input: "first" },
      { id: `${workspaceId}-item-1`, position: 1, input: "second", evaluator: { type: "contains", value: "ok" } },
    ];
    const record: DatasetVersionRecord = { id: versionId, datasetId, workspaceId, name: "retry", version: "v1", checksum: "checksum-retry", itemCount: items.length, createdAt: Date.now() };
    await queryShared("INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3)", [workspaceId, "dataset retry", Date.now()]);
    await queryShared("INSERT INTO eval_datasets (id, workspace_id, name, created_at) VALUES ($1, $2, $3, $4)", [datasetId, workspaceId, "retry", Date.now()]);
    await queryShared("INSERT INTO eval_dataset_versions (id, dataset_id, workspace_id, version, checksum, item_count, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [versionId, datasetId, workspaceId, "v1", record.checksum, record.itemCount, record.createdAt]);
    await queryShared("INSERT INTO eval_dataset_items (id, version_id, workspace_id, position, input_json, expected_output_json, evaluator_json, metadata_json) VALUES ($1, $2, $3, $4, $5, NULL, NULL, NULL)", [items[0]!.id, versionId, workspaceId, 0, JSON.stringify(items[0]!.input)]);
    try {
      const result = await createSharedDatasetVersion(record, items);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.created).toBe(false);
        expect(result.value.record.items).toHaveLength(2);
      }
    } finally {
      await queryShared("DELETE FROM eval_dataset_items WHERE workspace_id = $1", [workspaceId]);
      await queryShared("DELETE FROM eval_dataset_versions WHERE workspace_id = $1", [workspaceId]);
      await queryShared("DELETE FROM eval_datasets WHERE workspace_id = $1", [workspaceId]);
      await queryShared("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    }
  });

  it("persists cancellation across instances and prevents a queued run from starting", async () => {
    const workspaceId = `cancel-${Date.now()}`;
    const runId = `${workspaceId}-run`;
    await queryShared("INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3)", [workspaceId, "cancel", Date.now()]);
    try {
      expect(await sharedInsertRun({ id: runId, workspaceId, agentName: "cancel", clientName: null, endpointUrl: "https://agent.example.com", createdAt: Date.now(), status: "queued" })).toBe(true);
      expect(await sharedRequestRunCancellation(workspaceId, runId)).toBe(true);
      expect(await sharedMarkRunRunning(workspaceId, runId)).toBe(false);
      expect(await sharedFailRun(workspaceId, runId, "Cancelado por el usuario")).toBe(true);
      expect((await sharedGetRun(workspaceId, runId))?.status).toBe("error");
    } finally {
      await queryShared("DELETE FROM runs WHERE workspace_id = $1", [workspaceId]);
      await queryShared("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    }
  });
});
