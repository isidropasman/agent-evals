import { afterEach, describe, expect, it } from "vitest";
import { generateTaskCases, executeTask } from "@/engine/tasks";
import { runEval, type Providers } from "@/engine/runner";
import { MockProvider, type CompletionRequest } from "@/engine/provider";
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

describe("generateTaskCases", () => {
  it("maps generated cases to scenarios with input + expected", async () => {
    const provider = new MockProvider([
      (req: CompletionRequest) =>
        req.system.includes("procesan documentos")
          ? JSON.stringify({
              cases: [
                { title: "Factura simple", document: "Factura #1 Total: $100", expected: "total=100" },
              ],
            })
          : null,
    ]);
    const r = await generateTaskCases(provider, "m", "Extraé el total de facturas.", {
      scenarioCount: 3,
      mix: { happy_path: 1, edge_case: 1, adversarial: 1 },
      k: 1,
      weights: { happy_path: 0.4, edge_case: 0.3, adversarial: 0.3 },
      maxTurns: 1,
      concurrency: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 1 case per category × 3 categories
      expect(r.value.length).toBe(3);
      const first = r.value[0]!;
      expect(first.input).toBe("Factura #1 Total: $100");
      expect(first.successCriteria).toBe("total=100"); // expected → successCriteria
      expect(first.maxTurns).toBe(1);
    }
  });
});

describe("executeTask", () => {
  it("sends the document single-shot and returns a 2-turn transcript", async () => {
    let received = "";
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      received = body.messages[body.messages.length - 1]?.content ?? "";
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"total":100}' } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const r = await executeTask(
      conn,
      {
        id: "t1",
        category: "happy_path",
        title: "t",
        persona: "(doc)",
        objective: "procesar",
        successCriteria: "total=100",
        maxTurns: 1,
        input: "Factura #1 Total: $100",
      },
      "s1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(received).toBe("Factura #1 Total: $100");
      expect(r.value).toHaveLength(2);
      expect(r.value[0]!.role).toBe("user");
      expect(r.value[1]!.content).toBe('{"total":100}');
    }
  });
});

describe("runEval in task mode", () => {
  it("runs the full task pipeline (generate docs -> send -> judge -> passK)", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"total":100}' } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const providers: Providers = {
      scenarioGen: new MockProvider([
        (req) =>
          req.system.includes("procesan documentos")
            ? JSON.stringify({
                cases: [{ title: "F1", document: "Factura Total $100", expected: "total=100" }],
              })
            : null,
      ]),
      userSim: new MockProvider([() => "unused in task mode"]),
      judge: new MockProvider([
        (req) => {
          if (req.system.includes("binary pass/fail")) {
            return JSON.stringify({ items: [{ criterion: "no inventa campos" }] });
          }
          if (req.system.includes("strict evaluator")) {
            return JSON.stringify({ pass: true, failedCriteria: [], rationale: "extrajo bien" });
          }
          return null;
        },
      ]),
      fixer: new MockProvider([
        () => JSON.stringify({ problem: "x", diff: "y", rationale: "z" }),
      ]),
      judgeModel: "mock-judge",
    };

    const result = await runEval(
      {
        connection: conn,
        agentSystemPrompt: "Extraé el total de cada factura.",
        agentFamily: "openai",
        mode: "task",
        config: {
          scenarioCount: 3,
          mix: { happy_path: 1, edge_case: 1, adversarial: 1 },
          k: 2,
          maxTurns: 1,
          concurrency: 4,
        },
      },
      providers,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.scenarios).toBe(3);
    expect(result.value.totals.conversations).toBe(6); // 3 docs × k=2
    expect(result.value.score).toBeCloseTo(1, 5);
    // The transcript in task mode is [document, output]
    const firstAttempt = result.value.scenarioResults[0]!.attempts[0]!;
    expect(firstAttempt.transcript[0]!.content).toContain("Factura");
  });
});
