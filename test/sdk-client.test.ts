import { describe, expect, it } from "vitest";
import { createGauntletClient } from "@/sdk/client";

describe("Gauntlet SDK client", () => {
  it("sends workspace credentials and unwraps agent responses", async () => {
    let request: RequestInit | undefined;
    const client = createGauntletClient({
      baseUrl: "http://localhost:3000/",
      apiKey: "gk_test_secret",
      fetchImpl: async (_url, init) => {
        request = init;
        return new Response(JSON.stringify({ agent: { id: "agent-1", name: "Support" } }), { status: 201 });
      },
    });
    const result = await client.registerAgent({ name: "Support" });
    expect(result).toEqual({ ok: true, value: { id: "agent-1", name: "Support" } });
    expect(request?.headers).toMatchObject({ authorization: "Bearer gk_test_secret" });
  });

  it("returns typed HTTP errors", async () => {
    const client = createGauntletClient({
      baseUrl: "http://localhost:3000",
      apiKey: "gk_test_secret",
      fetchImpl: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    });
    expect(await client.ingestTrace({
      traceId: "t",
      eventId: "e",
      agentId: "a",
      kind: "run",
      occurredAt: 1,
    })).toEqual({ ok: false, error: { kind: "http", message: "unauthorized", status: 401 } });
  });

  it("reads workspace data with query parameters", async () => {
    const calls: string[] = [];
    const client = createGauntletClient({
      baseUrl: "http://gauntlet.test",
      apiKey: "gk_test",
      fetchImpl: (async (url, init) => {
        calls.push(`${init?.method}:${String(url)}`);
        return new Response(JSON.stringify({ traces: [] }), { status: 200 });
      }) as typeof fetch,
    });
    const result = await client.listTraces({ agentId: "agent-1", limit: 10 });
    expect(result).toEqual({ ok: true, value: { traces: [] } });
    expect(calls).toEqual(["GET:http://gauntlet.test/api/v1/traces?agentId=agent-1&limit=10"]);
  });

  it("keeps the replay envelope while unwrapping promoted cases", async () => {
    const calls: string[] = [];
    const client = createGauntletClient({
      baseUrl: "http://gauntlet.test",
      apiKey: "gk_test",
      fetchImpl: (async (url, init) => {
        calls.push(`${init?.method}:${String(url)}`);
        if (String(url).endsWith("from-trace")) {
          return new Response(JSON.stringify({ case: { id: "case-1", name: "safe" } }), { status: 201 });
        }
        return new Response(JSON.stringify({ case: { id: "case-1" }, replay: { passed: true, latencyMs: 40, verdict: { pass: true, failedCriteria: [], rationale: "ok" } } }), { status: 200 });
      }) as typeof fetch,
    });
    expect(await client.promoteTrace({ agentId: "agent-1", traceId: "trace-1" })).toEqual({
      ok: true,
      value: { id: "case-1", name: "safe" },
    });
    expect(await client.replayCase("case/1")).toMatchObject({ ok: true, value: { replay: { passed: true } } });
    expect(calls).toEqual([
      "POST:http://gauntlet.test/api/v1/cases/from-trace",
      "POST:http://gauntlet.test/api/v1/cases/case%2F1/replay",
    ]);
  });

  it("sends a versioned multi-case gate request", async () => {
    let body = "";
    const client = createGauntletClient({
      baseUrl: "http://gauntlet.test",
      apiKey: "gk_test",
      fetchImpl: (async (_url, init) => {
        body = String(init?.body);
        return new Response(JSON.stringify({ status: "pass", version: "commit-b", total: 2, passed: 2, failed: 0, errors: 0, regressions: 0, cases: [] }), { status: 201 });
      }) as typeof fetch,
    });
    const result = await client.runGate({ caseIds: ["case-1", "case-2"], version: "commit-b", concurrency: 2 });
    expect(result).toMatchObject({ ok: true, value: { status: "pass", version: "commit-b" } });
    expect(JSON.parse(body)).toEqual({ caseIds: ["case-1", "case-2"], version: "commit-b", concurrency: 2 });
  });

  it("polls an asynchronous gate until the durable worker completes", async () => {
    let calls = 0;
    const client = createGauntletClient({
      baseUrl: "http://gauntlet.test",
      apiKey: "gk_test",
      fetchImpl: (async (url, init) => {
        calls += 1;
        if (init?.method === "POST") return new Response(JSON.stringify({ gateRunId: "gate-1", status: "queued" }), { status: 202 });
        expect(String(url)).toContain("/api/v1/gates/gate-1");
        return new Response(JSON.stringify({ gate: { id: "gate-1", status: "pass", total: 1, passed: 1, failed: 0, errors: 0, regressions: 0, version: "v1", baselineVersion: null, createdAt: 1, completedAt: 2 }, cases: [] }), { status: 200 });
      }) as typeof fetch,
    });
    const result = await client.runGate();
    expect(result).toMatchObject({ ok: true, value: { id: "gate-1", status: "pass" } });
    expect(calls).toBe(2);
  });
});
