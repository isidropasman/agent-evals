import { describe, expect, it } from "vitest";
import { extractJson } from "@/engine/json";
import { MockProvider, type CompletionRequest } from "@/engine/provider";
import { runEval, type Providers } from "@/engine/runner";
import { judgeConversation } from "@/engine/judge";
import type { AgentConnection } from "@/engine/connector";
import type { Rubric, Scenario } from "@/engine/types";

describe("extractJson", () => {
  it("parses bare JSON", () => {
    const r = extractJson<{ a: number }>('{"a": 1}');
    expect(r.ok && r.value.a).toBe(1);
  });

  it("parses fenced JSON", () => {
    const r = extractJson<{ a: number }>('```json\n{"a": 2}\n```');
    expect(r.ok && r.value.a).toBe(2);
  });

  it("parses JSON embedded in prose", () => {
    const r = extractJson<{ a: number }>('Here you go: {"a": 3}. Done.');
    expect(r.ok && r.value.a).toBe(3);
  });

  it("fails cleanly on garbage", () => {
    const r = extractJson("no json here");
    expect(r.ok).toBe(false);
  });
});

describe("judge enforces binary invariant", () => {
  it("forces pass=false when failedCriteria is non-empty", async () => {
    const provider = new MockProvider([
      () => JSON.stringify({ pass: true, failedCriteria: ["hallucinated"], rationale: "x" }),
    ]);
    const scenario: Scenario = {
      id: "t1",
      category: "happy_path",
      title: "t",
      persona: "p",
      objective: "o",
      successCriteria: "s",
      maxTurns: 4,
    };
    const rubric: Rubric = { items: [{ id: "r1", criterion: "no hallucination" }] };
    const v = await judgeConversation(provider, "m", scenario, rubric, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "bye" },
    ]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.pass).toBe(false);
  });
});

/**
 * Full pipeline in mock mode. A stub agent HTTP server, a mock LLM provider
 * routed by system-prompt markers, and the real runner — exercises scenario
 * gen, simulation, judging, pass^k, scoring, and fix generation end to end.
 */
describe("runEval full pipeline (mock)", () => {
  it("runs 6 scenarios × k=2 and computes a weighted score", async () => {
    const agentReplies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      const lastUser = body.messages.filter((m) => m.role === "user").pop();
      agentReplies.push(lastUser?.content ?? "");
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "Puedo ayudarte con eso dentro de mi alcance." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const scenarioGen = new MockProvider([
        (req: CompletionRequest) => {
          if (!req.system.includes("design test scenarios")) return null;
          // 2 scenarios per category call
          return JSON.stringify({
            scenarios: [
              { title: "S1", persona: "p", objective: "o", successCriteria: "agent stays in scope" },
              { title: "S2", persona: "p", objective: "o", successCriteria: "agent stays in scope" },
            ],
          });
        },
      ]);

      const rubricProvider = new MockProvider([
        (req) =>
          req.system.includes("binary pass/fail")
            ? JSON.stringify({ items: [{ criterion: "stays in scope" }] })
            : null,
        (req) =>
          req.system.includes("strict evaluator")
            ? JSON.stringify({ pass: true, failedCriteria: [], rationale: "ok" })
            : null,
      ]);

      const userSim = new MockProvider([
        (req) => (req.system.includes("role-playing a user") ? "Hola, una pregunta." : null),
      ]);

      const fixer = new MockProvider([
        (req) =>
          req.system.includes("improve AI agent system prompts")
            ? JSON.stringify({ problem: "x", diff: "y", rationale: "z" })
            : null,
      ]);

      const providers: Providers = {
        scenarioGen,
        userSim,
        judge: rubricProvider,
        fixer,
        judgeModel: "mock-judge",
      };

      const connection: AgentConnection = {
        endpointUrl: "http://127.0.0.1:9/v1/chat/completions",
        protocol: "openai",
        authType: "none",
      };

      const result = await runEval(
        {
          connection,
          agentSystemPrompt: "You are a support agent. Stay in scope.",
          agentFamily: "openai",
          config: {
            scenarioCount: 6,
            mix: { happy_path: 2, edge_case: 2, adversarial: 2 },
            k: 2,
            maxTurns: 2,
            concurrency: 4,
          },
        },
        providers,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const report = result.value;
      expect(report.totals.scenarios).toBe(6);
      expect(report.totals.conversations).toBe(12);
      // all judged pass → score 1.0, certified
      expect(report.score).toBeCloseTo(1, 5);
      expect(report.certified).toBe(true);
      expect(report.categories).toHaveLength(3);
      expect(agentReplies.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pass^k fails a scenario if any attempt fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "reply" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    let judgeCall = 0;
    try {
      const providers: Providers = {
        scenarioGen: new MockProvider([
          (req) =>
            req.system.includes("design test scenarios")
              ? JSON.stringify({
                  scenarios: [{ title: "S1", persona: "p", objective: "o", successCriteria: "c" }],
                })
              : null,
        ]),
        userSim: new MockProvider([
          (req) => (req.system.includes("role-playing a user") ? "hola" : null),
        ]),
        judge: new MockProvider([
          (req) => {
            if (req.system.includes("binary pass/fail")) {
              return JSON.stringify({ items: [{ criterion: "c" }] });
            }
            if (req.system.includes("strict evaluator")) {
              judgeCall++;
              // first attempt passes, second fails
              return judgeCall === 1
                ? JSON.stringify({ pass: true, failedCriteria: [], rationale: "ok" })
                : JSON.stringify({ pass: false, failedCriteria: ["c"], rationale: "no" });
            }
            return null;
          },
        ]),
        fixer: new MockProvider([
          (req) =>
            req.system.includes("improve AI agent system prompts")
              ? JSON.stringify({ problem: "x", diff: "y", rationale: "z" })
              : null,
        ]),
        judgeModel: "mock-judge",
      };

      const result = await runEval(
        {
          connection: {
            endpointUrl: "http://127.0.0.1:9/v1/chat/completions",
            protocol: "openai",
            authType: "none",
          },
          agentSystemPrompt: "prompt",
          agentFamily: "openai",
          config: {
            scenarioCount: 1,
            mix: { happy_path: 1, edge_case: 0, adversarial: 0 },
            k: 2,
            maxTurns: 1,
            concurrency: 1,
          },
        },
        providers,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 1 scenario, 2 attempts, one failed → passK false → not certified
      expect(result.value.totals.passed).toBe(0);
      expect(result.value.certified).toBe(false);
      expect(result.value.fixes.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
