import { afterEach, describe, expect, it } from "vitest";
import { probeAgent } from "@/engine/connector";
import { runEval, RunAbortedError, type Providers } from "@/engine/runner";
import { MockProvider } from "@/engine/provider";
import type { AgentConnection } from "@/engine/connector";

const conn: AgentConnection = {
  endpointUrl: "http://127.0.0.1:9/v1/chat/completions",
  protocol: "openai",
  authType: "none",
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("probeAgent", () => {
  it("returns the agent reply on success", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "hola!" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const r = await probeAgent(conn);
    expect(r.ok && r.value).toBe("hola!");
  });

  it("fails cleanly on a dead endpoint", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const r = await probeAgent(conn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("connector_unreachable");
  });

  it("fails on non-JSON content type", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>nope</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    const r = await probeAgent(conn);
    expect(r.ok).toBe(false);
  });
});

describe("runEval preflight + cancel", () => {
  it("fails fast if the agent is unreachable (preflight)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const providers: Providers = {
      profiler: new MockProvider([() => "{}"]),
      toolMocker: new MockProvider([]),
      scenarioGen: new MockProvider([() => "{}"]),
      userSim: new MockProvider([() => "{}"]),
      judge: new MockProvider([() => "{}"]),
      fixer: new MockProvider([() => "{}"]),
      judgeModel: "m",
    };
    const r = await runEval(
      { connection: conn, agentSystemPrompt: "p", agentFamily: "openai" },
      providers,
    );
    // Preflight probe fails → whole run errors before generating scenarios
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("connector_unreachable");
  });

  it("aborts a run when the signal fires", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "reply" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const controller = new AbortController();
    controller.abort(); // pre-aborted → pool throws at first job

    const providers: Providers = {
      profiler: new MockProvider([]),
      toolMocker: new MockProvider([]),
      scenarioGen: new MockProvider([
        (req) =>
          req.system.includes("design test scenarios")
            ? JSON.stringify({ scenarios: [{ title: "S", persona: "p", objective: "o", successCriteria: "c" }] })
            : null,
      ]),
      userSim: new MockProvider([(req) => (req.system.includes("role-playing a user") ? "hi" : null)]),
      judge: new MockProvider([
        (req) =>
          req.system.includes("binary pass/fail")
            ? JSON.stringify({ items: [{ criterion: "c" }] })
            : JSON.stringify({ pass: true, failedCriteria: [], rationale: "ok" }),
      ]),
      fixer: new MockProvider([() => JSON.stringify({ problem: "x", diff: "y", rationale: "z" })]),
      judgeModel: "m",
    };

    await expect(
      runEval(
        {
          connection: conn,
          agentSystemPrompt: "p",
          agentFamily: "openai",
          signal: controller.signal,
          config: { scenarioCount: 1, mix: { happy_path: 1, edge_case: 0, adversarial: 0 }, k: 1, maxTurns: 1, concurrency: 1 },
        },
        providers,
      ),
    ).rejects.toBeInstanceOf(RunAbortedError);
  });
});
