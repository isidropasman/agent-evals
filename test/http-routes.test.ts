import { describe, expect, it } from "vitest";
import { GET as listAgents, POST as registerAgent } from "@/app/api/v1/agents/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { GET as listTraces, POST as ingestTrace } from "@/app/api/v1/traces/route";
import { GET as listRuns, POST as startRun } from "@/app/api/v1/runs/route";
import { GET as recentTraces } from "@/app/api/traces/route";
import { GET as listCases } from "@/app/api/v1/cases/route";
import { POST as promoteTraceFromTrace } from "@/app/api/v1/cases/from-trace/route";
import { GET as listGates, POST as runGate } from "@/app/api/v1/gates/route";
import { POST as ingestTraceBatch } from "@/app/api/v1/traces/batch/route";
import { GET as listDatasets, POST as createDataset } from "@/app/api/v1/datasets/route";
import { GET as listSuites, POST as createSuite } from "@/app/api/v1/suites/route";

describe("v1 integration routes", () => {
  it("bootstraps a key locally, registers an agent, and ingests idempotently", async () => {
    const keyResponse = await createKey(jsonRequest({ name: `route-test-${Date.now()}` }));
    expect(keyResponse.status).toBe(201);
    const keyBody = (await keyResponse.json()) as { key: { token: string } };

    const externalId = `route-agent-${Date.now()}`;
    const agentResponse = await registerAgent(jsonRequest({
      name: "Route agent",
      externalId,
      source: "sdk",
    }, keyBody.key.token));
    expect(agentResponse.status).toBe(201);
    const agentBody = (await agentResponse.json()) as { agent: { id: string; canRun: boolean } };
    expect(agentBody.agent.canRun).toBe(false);

    const event = {
      traceId: `route-trace-${Date.now()}`,
      eventId: `route-event-${Date.now()}`,
      agentId: agentBody.agent.id,
      kind: "assertion",
      assertion: { name: "no secret leakage", passed: true },
      occurredAt: Date.now(),
    };
    const first = await ingestTrace(jsonRequest(event, keyBody.key.token));
    const second = await ingestTrace(jsonRequest(event, keyBody.key.token));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
  });

  it("rejects missing credentials and invalid trace bodies", async () => {
    const unauthorized = await ingestTrace(jsonRequest({}));
    expect(unauthorized.status).toBe(401);

    const keyResponse = await createKey(jsonRequest({ name: `invalid-test-${Date.now()}` }));
    const keyBody = (await keyResponse.json()) as { key: { token: string } };
    const invalid = await ingestTrace(jsonRequest({ kind: "turn" }, keyBody.key.token));
    expect(invalid.status).toBe(400);
    const invalidLimit = await listTraces(new Request("http://localhost/api/v1/traces?limit=0", {
      headers: { authorization: `Bearer ${keyBody.key.token}` },
    }));
    expect(invalidLimit.status).toBe(400);
  });

  it("reads workspace-scoped agents, traces, and runs", async () => {
    const keyResponse = await createKey(jsonRequest({ name: `read-test-${Date.now()}` }));
    const keyBody = (await keyResponse.json()) as { key: { token: string } };
    const agentResponse = await registerAgent(jsonRequest({
      name: "Read agent",
      externalId: `read-agent-${Date.now()}`,
      source: "ci",
    }, keyBody.key.token));
    const agentBody = (await agentResponse.json()) as { agent: { id: string } };
    const event = {
      traceId: `read-trace-${Date.now()}`,
      eventId: `read-event-${Date.now()}`,
      agentId: agentBody.agent.id,
      kind: "assertion",
      assertion: { name: "safe", passed: false },
      occurredAt: Date.now(),
    };
    await ingestTrace(jsonRequest(event, keyBody.key.token));

    const agents = await listAgents(authRequest(keyBody.key.token));
    const traces = await listTraces(new Request("http://localhost/api/v1/traces?limit=1", {
      headers: { authorization: `Bearer ${keyBody.key.token}` },
    }));
    const runs = await listRuns(authRequest(keyBody.key.token));
    expect(agents.status).toBe(200);
    expect(traces.status).toBe(200);
    expect(runs.status).toBe(200);
    expect(((await traces.json()) as { traces: unknown[] }).traces).toHaveLength(1);
    expect(((await agents.json()) as { agents: unknown[] }).agents.length).toBeGreaterThan(0);
    expect(((await runs.json()) as { runs: unknown[] }).runs).toBeInstanceOf(Array);
    const feed = await recentTraces(new Request("http://localhost/api/traces?limit=100"));
    expect(feed.status).toBe(200);
    expect(((await feed.json()) as { traces: Array<{ agentName: string }> }).traces).toContainEqual(expect.objectContaining({ agentName: "Read agent" }));
  });

  it("rejects a missing subscription before enqueuing an authenticated run", async () => {
    const keyResponse = await createKey(jsonRequest({ name: `run-subscription-${Date.now()}` }));
    const keyBody = (await keyResponse.json()) as { key: { token: string } };
    const agentResponse = await registerAgent(jsonRequest({
      name: "Runnable subscription agent",
      externalId: `run-subscription-agent-${Date.now()}`,
      endpointUrl: "http://127.0.0.1:9/chat",
      systemPrompt: "Be safe.",
      source: "sdk",
    }, keyBody.key.token));
    const agentBody = (await agentResponse.json()) as { agent: { id: string } };
    const response = await startRun(jsonRequest({
      agentId: agentBody.agent.id,
      subscriptionConnectionId: "missing-connection",
    }, keyBody.key.token));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "subscription unavailable" });
  });

  it("promotes a trace through the authenticated regression API", async () => {
    const keyResponse = await createKey(jsonRequest({ name: `case-test-${Date.now()}` }));
    const keyBody = (await keyResponse.json()) as { key: { token: string } };
    const agentResponse = await registerAgent(jsonRequest({
      name: "Case agent",
      externalId: `case-agent-${Date.now()}`,
      source: "sdk",
    }, keyBody.key.token));
    const agentBody = (await agentResponse.json()) as { agent: { id: string } };
    const traceId = `case-trace-${Date.now()}`;
    const ingested = await ingestTrace(jsonRequest({
      traceId,
      eventId: `case-event-${Date.now()}`,
      agentId: agentBody.agent.id,
      kind: "assertion",
      input: { message: "keep this private", apiKey: "redact-me" },
      assertion: { name: "does not leak secrets", passed: false },
      occurredAt: Date.now(),
    }, keyBody.key.token));
    expect(ingested.status).toBe(201);

    const promoted = await promoteTraceFromTrace(jsonRequest({ agentId: agentBody.agent.id, traceId }, keyBody.key.token));
    expect(promoted.status).toBe(201);
    expect(await promoted.json()).toMatchObject({ case: { sourceTraceId: traceId } });
    const cases = await listCases(authRequest(keyBody.key.token));
    expect(cases.status).toBe(200);
    expect(((await cases.json()) as { cases: Array<{ sourceTraceId: string }> }).cases).toContainEqual(expect.objectContaining({ sourceTraceId: traceId }));
  });

  it("requires auth and validates gate selections", async () => {
    expect((await listGates(authRequest("not-a-key"))).status).toBe(401);
    const keyResponse = await createKey(jsonRequest({ name: `gate-test-${Date.now()}` }));
    const keyBody = (await keyResponse.json()) as { key: { token: string } };
    const invalid = await runGate(jsonRequest({ caseIds: ["not-in-workspace"] }, keyBody.key.token));
    expect(invalid.status).toBe(404);
    const gates = await listGates(authRequest(keyBody.key.token));
    expect(gates.status).toBe(200);
    expect(((await gates.json()) as { gates: unknown[] }).gates).toBeInstanceOf(Array);
  });

  it("ingests traces in batches and creates immutable dataset-backed suite metadata", async () => {
    const keyResponse = await createKey(jsonRequest({ name: `batch-test-${Date.now()}` }));
    const keyBody = (await keyResponse.json()) as { key: { token: string } };
    const agentResponse = await registerAgent(jsonRequest({ name: "Batch agent", externalId: `batch-agent-${Date.now()}`, source: "sdk" }, keyBody.key.token));
    const agent = (await agentResponse.json()) as { agent: { id: string } };
    const event = { traceId: `batch-trace-${Date.now()}`, eventId: `batch-event-${Date.now()}`, agentId: agent.agent.id, kind: "turn", occurredAt: Date.now(), input: { message: "hello", apiKey: "redacted" } };
    const batch = await ingestTraceBatch(jsonRequest({ traces: [event, event, { kind: "turn" }] }, keyBody.key.token));
    expect(batch.status).toBe(200);
    expect(await batch.json()).toMatchObject({ accepted: [event.eventId], duplicates: [event.eventId], rejected: [{ index: 2 }] });
    const dataset = await createDataset(jsonRequest({ name: `dataset-${Date.now()}`, version: "v1", items: [{ input: "hello", evaluator: { type: "contains", value: "ok" } }] }, keyBody.key.token));
    expect(dataset.status).toBe(201);
    const datasetBody = (await dataset.json()) as { dataset: { id: string } };
    const suite = await createSuite(jsonRequest({ name: `suite-${Date.now()}`, version: "v1", datasetVersionId: datasetBody.dataset.id }, keyBody.key.token));
    expect(suite.status).toBe(201);
    const datasets = await listDatasets(authRequest(keyBody.key.token));
    expect(datasets.status).toBe(200);
    expect(((await datasets.json()) as { datasets: Array<{ id: string }> }).datasets).toContainEqual(expect.objectContaining({ id: datasetBody.dataset.id }));
    expect((await listSuites(authRequest(keyBody.key.token))).status).toBe(200);
  });
});

function jsonRequest(body: unknown, token?: string): Request {
  return new Request("http://localhost/api/v1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function authRequest(token: string): Request {
  return new Request("http://localhost/api/v1", {
    headers: { authorization: `Bearer ${token}` },
  });
}
