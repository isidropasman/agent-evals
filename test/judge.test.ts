import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockProvider, OpenAiProvider } from "@/engine/provider";
import { defaultProviders, pickJudge, runEval } from "@/engine/runner";
import { keyStatus, resolveKey, storeKey } from "@/server/keys";

/**
 * The cross-family judge is a credibility claim printed on the certificate, so
 * these guard the claim itself: that a same-family pairing is disclosed, and
 * that supplying an OpenAI key actually moves the judge rather than only
 * changing the wording.
 */
describe("judge family selection", () => {
  const anthropicJudge = { family: "anthropic" as const, complete: async () => ({ ok: true as const, value: "" }) };
  const openaiJudge = { family: "openai" as const, complete: async () => ({ ok: true as const, value: "" }) };

  it("discloses when the judge shares the agent's model family", () => {
    const picked = pickJudge("anthropic", anthropicJudge, "claude-sonnet-5");
    expect(picked.disclaimer).toContain("self-preference");
    expect(picked.model).toBe("claude-sonnet-5");
  });

  it("stays silent when the judge is cross-family", () => {
    expect(pickJudge("anthropic", openaiJudge, "gpt-4.1").disclaimer).toBeNull();
    expect(pickJudge("openai", anthropicJudge, "claude-sonnet-5").disclaimer).toBeNull();
  });

  it("does not disclose when the agent's family is unknown", () => {
    expect(pickJudge("unknown", anthropicJudge, "claude-sonnet-5").disclaimer).toBeNull();
  });
});

describe("defaultProviders", () => {
  const savedOpenAi = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (savedOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedOpenAi;
  });

  it("keeps the judge on Anthropic when no OpenAI key exists", () => {
    delete process.env.OPENAI_API_KEY;
    const providers = defaultProviders("sk-ant-test");
    expect(providers.judge.family).toBe("anthropic");
    expect(providers.judgeModel).toMatch(/^claude-/);
  });

  it("moves only the judge to OpenAI when a key is supplied", () => {
    const providers = defaultProviders("sk-ant-test", "sk-openai-test");
    expect(providers.judge.family).toBe("openai");
    expect(providers.scenarioGen.family).toBe("anthropic");
    expect(providers.userSim.family).toBe("anthropic");
    expect(providers.judgeModel).not.toMatch(/^claude-/);
  });

  it("picks up an OpenAI key from the environment", () => {
    process.env.OPENAI_API_KEY = "sk-openai-from-env";
    expect(defaultProviders("sk-ant-test").judge.family).toBe("openai");
  });
});

describe("OpenAiProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const request = {
    model: "gpt-4.1",
    system: "s",
    maxTokens: 100,
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("returns the assistant message content", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "veredicto" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const result = await new OpenAiProvider("sk-test").complete(request);
    expect(result.ok && result.value).toBe("veredicto");
  });

  it("sends the key as a bearer token to the configured base URL", async () => {
    let seenUrl = "";
    let seenAuth = "";
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = String((init?.headers as Record<string, string>).authorization);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await new OpenAiProvider("sk-test", "https://gateway.example/v1/").complete(request);
    expect(seenUrl).toBe("https://gateway.example/v1/chat/completions");
    expect(seenAuth).toBe("Bearer sk-test");
  });

  it("fails immediately on a non-retryable status instead of burning retries", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("bad key", { status: 401 });
    }) as typeof fetch;

    const result = await new OpenAiProvider("sk-test").complete(request);
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("provider_error");
  });
});

describe("api key resolution", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    storeKey("anthropic", null);
  });
  afterEach(() => {
    storeKey("anthropic", null);
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("reports nothing configured when neither source has a key", () => {
    expect(keyStatus("anthropic")).toEqual({ configured: false, source: null, masked: null });
    expect(resolveKey("anthropic")).toBeNull();
  });

  it("persists a key stored through the UI path", () => {
    storeKey("anthropic", "sk-ant-stored-value-1234567890");
    expect(resolveKey("anthropic")).toBe("sk-ant-stored-value-1234567890");
    expect(keyStatus("anthropic").source).toBe("stored");
  });

  it("lets the environment win, so an existing shell setup keeps working", () => {
    storeKey("anthropic", "sk-ant-stored-value-1234567890");
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env-0987654321";
    expect(resolveKey("anthropic")).toBe("sk-ant-from-env-0987654321");
    expect(keyStatus("anthropic").source).toBe("env");
  });

  it("never exposes the key in its masked form", () => {
    storeKey("anthropic", "sk-ant-supersecretvalue-abcdef");
    const masked = keyStatus("anthropic").masked ?? "";
    expect(masked).not.toContain("supersecret");
    expect(masked).toContain("…");
  });

  it("clears a stored key", () => {
    storeKey("anthropic", "sk-ant-stored-value-1234567890");
    storeKey("anthropic", null);
    expect(resolveKey("anthropic")).toBeNull();
  });
});

/**
 * The first real benchmark run scored a healthy control agent at 53% — most of
 * those "failures" were the judge running out of tokens, whose error the runner
 * then recorded as `pass: false`. An agent must never be marked down for our
 * own inability to evaluate it.
 */
describe("a judge that cannot return a verdict", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function runWithBrokenJudge() {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "reply" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const scenarioGen = new MockProvider([
      (req) =>
        req.system.includes("design test scenarios")
          ? JSON.stringify({
              scenarios: [{ title: "S", persona: "p", objective: "o", successCriteria: "c" }],
            })
          : null,
    ]);
    const judge = new MockProvider([
      (req) =>
        req.system.includes("binary pass/fail")
          ? JSON.stringify({ items: [{ criterion: "c" }] })
          : null,
      // No handler for "strict evaluator" → every verdict call errors.
    ]);

    return runEval(
      {
        connection: {
          endpointUrl: "http://127.0.0.1:9/v1/chat/completions",
          protocol: "openai",
          authType: "none",
        },
        agentSystemPrompt: "prompt",
        agentFamily: "openai",
        config: {
          scenarioCount: 3,
          mix: { happy_path: 1, edge_case: 1, adversarial: 1 },
          k: 2,
          maxTurns: 1,
          concurrency: 3,
        },
      },
      {
        profiler: new MockProvider([]),
        toolMocker: new MockProvider([]),
        scenarioGen,
        userSim: new MockProvider([
          (req) => (req.system.includes("role-playing a user") ? "hola" : null),
        ]),
        judge,
        fixer: new MockProvider([]),
        judgeModel: "mock-judge",
      },
    );
  }

  it("marks the conversations unevaluated instead of failing the agent", async () => {
    const result = await runWithBrokenJudge();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.totals.unevaluated).toBe(6);
    for (const scenario of result.value.scenarioResults) {
      expect(scenario.unevaluated).toBe(true);
      expect(scenario.passK).toBe(false);
      // No criterion was ever actually evaluated, so none may be reported failed.
      for (const attempt of scenario.attempts) {
        expect(attempt.verdict.failedCriteria).toEqual([]);
      }
    }
  });

  it("keeps unevaluated scenarios out of the category denominators", async () => {
    const result = await runWithBrokenJudge();
    if (!result.ok) return;
    expect(result.value.categories.every((c) => c.total === 0)).toBe(true);
  });

  it("refuses to certify a run it could not evaluate", async () => {
    const result = await runWithBrokenJudge();
    if (!result.ok) return;
    // Without the coverage gate an all-unjudged run computes score 0 and is
    // merely "not certified"; the danger is the inverse — a run where the few
    // judged conversations happen to pass must not mint a certificate either.
    expect(result.value.certified).toBe(false);
  });
});

/** MockProvider is the backbone of every offline test; a silent behavior
 * change there would quietly weaken the whole suite. */
describe("MockProvider", () => {
  it("errors instead of inventing a response when no handler matches", async () => {
    const result = await new MockProvider([]).complete({
      model: "m",
      system: "unmatched",
      maxTokens: 10,
      messages: [],
    });
    expect(result.ok).toBe(false);
  });
});
