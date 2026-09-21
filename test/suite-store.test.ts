import { describe, expect, it } from "vitest";
import { createAgent } from "@/server/agent-store";
import { createDatasetVersion } from "@/server/dataset-store";
import { createSuite, listWorkspaceSuites } from "@/server/suite-store";
import { getDefaultWorkspace } from "@/server/workspace-store";
import { listRegressionCases } from "@/server/db";

describe("suite manifests", () => {
  it("materializes dataset items as immutable replay cases for a target agent", async () => {
    const workspaceId = getDefaultWorkspace().id;
    const suffix = Date.now().toString();
    const agent = createAgent({ name: `Suite agent ${suffix}`, clientName: null, endpointUrl: "https://agent.example.com", protocol: "openai", authType: "none", systemPrompt: "Respond safely.", agentFamily: "unknown", tools: [] });
    const dataset = await createDatasetVersion(workspaceId, `suite-dataset-${suffix}`, "v1", [{ input: "hello", expectedOutput: { ok: true } }]);
    expect(dataset.ok).toBe(true);
    if (!dataset.ok) return;
    const suite = await createSuite(workspaceId, { name: `suite-${suffix}`, version: "v1", datasetVersionId: dataset.value.id, agentId: agent.id });
    expect(suite).toMatchObject({ ok: true, created: true, value: { agentId: agent.id, datasetChecksum: dataset.value.checksum } });
    if (!suite.ok) return;
    expect(listRegressionCases(workspaceId)).toContainEqual(expect.objectContaining({ suiteId: suite.value.id, evaluator: { type: "exact_json", value: { ok: true } } }));
    expect(await listWorkspaceSuites(workspaceId)).toContainEqual(expect.objectContaining({ id: suite.value.id, version: "v1" }));
  });
});
