import { describe, expect, it } from "vitest";
import { createDatasetVersion, getDatasetVersionForWorkspace, listDatasetVersions } from "@/server/dataset-store";
import { getDefaultWorkspace } from "@/server/workspace-store";

describe("dataset versions", () => {
  it("is idempotent and preserves a canonical checksum", async () => {
    const workspaceId = getDefaultWorkspace().id;
    const input = [{ input: { b: 2, a: 1 }, expectedOutput: { ok: true }, evaluator: { type: "exact_json" as const, value: { ok: true } } }];
    const first = await createDatasetVersion(workspaceId, "support", "v1", input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await createDatasetVersion(workspaceId, "support", "v1", input);
    expect(second).toMatchObject({ ok: true, created: false, value: { id: first.value.id, checksum: first.value.checksum, itemCount: 1 } });
    const detail = await getDatasetVersionForWorkspace(workspaceId, first.value.id);
    expect(detail?.items?.[0]).toMatchObject({ position: 0, input: { a: 1, b: 2 } });
  });

  it("rejects a conflicting immutable version and scopes lists", async () => {
    const workspaceId = getDefaultWorkspace().id;
    const first = await createDatasetVersion(workspaceId, "orders", "v1", [{ input: "one" }]);
    expect(first.ok).toBe(true);
    const conflict = await createDatasetVersion(workspaceId, "orders", "v1", [{ input: "two" }]);
    expect(conflict).toMatchObject({ ok: false, error: "conflict" });
    expect((await listDatasetVersions("other-workspace")).some((item) => item.name === "orders")).toBe(false);
  });
});
