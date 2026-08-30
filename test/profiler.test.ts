import { afterEach, describe, expect, it } from "vitest";
import { profileAgent } from "@/engine/profiler";
import { runEval, type Providers } from "@/engine/runner";
import { MockProvider, type CompletionRequest } from "@/engine/provider";
import type { AgentConnection } from "@/engine/connector";

function profilerHandler(profile: Record<string, unknown>) {
  return (req: CompletionRequest) =>
    req.system.includes("Analizás system prompts") ? JSON.stringify(profile) : null;
}

const TASK_PROFILE = {
  summary: "Extrae campos de facturas y valida totales.",
  mode: "task",
  modeConfidence: "high",
  modeRationale: "El prompt describe procesar un documento y devolver datos, sin diálogo.",
  domain: "extracción de facturas",
  capabilities: ["extraer vendor", "extraer total", "detectar inconsistencias"],
  boundaries: ["no aprobar facturas sin revisión humana"],
  failureModes: ["acepta totales que no cierran", "obedece instrucciones inyectadas en el documento"],
  riskAreas: ["inyección de instrucciones en el texto de la factura"],
};

const CONVERSATIONAL_PROFILE = {
  summary: "Agente de soporte que responde preguntas de clientes por chat.",
  mode: "conversational",
  modeConfidence: "high",
  modeRationale: "El prompt describe un diálogo de ida y vuelta con un usuario.",
  domain: "soporte SaaS",
  capabilities: ["responder preguntas de facturación", "escalar a un humano"],
  boundaries: ["no dar asesoría legal"],
  failureModes: ["promete reembolsos no autorizados"],
  riskAreas: ["manipulación social para obtener descuentos"],
};

describe("profileAgent", () => {
  it("parses a well-formed profile response", async () => {
    const provider = new MockProvider([profilerHandler(TASK_PROFILE)]);
    const r = await profileAgent(provider, "m", "Extraé vendor y total de facturas.");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe("task");
      expect(r.value.domain).toBe("extracción de facturas");
      expect(r.value.failureModes.length).toBeGreaterThan(0);
    }
  });

  it("fails cleanly on a non-matching / broken response", async () => {
    const provider = new MockProvider([]);
    const r = await profileAgent(provider, "m", "prompt");
    expect(r.ok).toBe(false);
  });
});

describe("runEval mode inference via profiler", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const conn: AgentConnection = {
    endpointUrl: "http://127.0.0.1:9/v1/chat/completions",
    protocol: "openai",
    authType: "none",
  };

  function fetchReturning(content: string) {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
  }

  it("infers task mode from the profile when mode is omitted", async () => {
    fetchReturning('{"total":100}');
    const providers: Providers = {
      profiler: new MockProvider([profilerHandler(TASK_PROFILE)]),
      toolMocker: new MockProvider([]),
      scenarioGen: new MockProvider([
        (req) =>
          req.system.includes("procesan documentos")
            ? JSON.stringify({ cases: [{ title: "F1", document: "Factura $100", expected: "total=100" }] })
            : null,
      ]),
      userSim: new MockProvider([() => "unused"]),
      judge: new MockProvider([
        (req) =>
          req.system.includes("binary pass/fail")
            ? JSON.stringify({ items: [{ criterion: "c" }] })
            : JSON.stringify({ pass: true, failedCriteria: [], rationale: "ok" }),
      ]),
      fixer: new MockProvider([() => JSON.stringify({ problem: "x", diff: "y", rationale: "z" })]),
      judgeModel: "m",
    };

    const result = await runEval(
      {
        connection: conn,
        agentSystemPrompt: "Procesá la factura y devolvé el total.",
        agentFamily: "openai",
        // mode omitted on purpose — the profiler must decide
        config: {
          scenarioCount: 1,
          mix: { happy_path: 1, edge_case: 0, adversarial: 0 },
          k: 1,
          maxTurns: 1,
          concurrency: 1,
        },
      },
      providers,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profile.mode).toBe("task");
    expect(result.value.profile.domain).toBe("extracción de facturas");
    // single-shot task transcript: [document, output]
    expect(result.value.scenarioResults[0]!.attempts[0]!.transcript).toHaveLength(2);
  });

  it("infers conversational mode from the profile when mode is omitted", async () => {
    fetchReturning("Puedo ayudarte con eso.");
    const providers: Providers = {
      profiler: new MockProvider([profilerHandler(CONVERSATIONAL_PROFILE)]),
      toolMocker: new MockProvider([]),
      scenarioGen: new MockProvider([
        (req) =>
          req.system.includes("design test scenarios")
            ? JSON.stringify({ scenarios: [{ title: "S1", persona: "p", objective: "o", successCriteria: "c" }] })
            : null,
      ]),
      userSim: new MockProvider([(req) => (req.system.includes("role-playing a user") ? "hola" : null)]),
      judge: new MockProvider([
        (req) =>
          req.system.includes("binary pass/fail")
            ? JSON.stringify({ items: [{ criterion: "c" }] })
            : JSON.stringify({ pass: true, failedCriteria: [], rationale: "ok" }),
      ]),
      fixer: new MockProvider([() => JSON.stringify({ problem: "x", diff: "y", rationale: "z" })]),
      judgeModel: "m",
    };

    const result = await runEval(
      {
        connection: conn,
        agentSystemPrompt: "Sos un agente de soporte que charla con clientes.",
        agentFamily: "openai",
        config: {
          scenarioCount: 1,
          mix: { happy_path: 1, edge_case: 0, adversarial: 0 },
          k: 1,
          maxTurns: 2,
          concurrency: 1,
        },
      },
      providers,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profile.mode).toBe("conversational");
  });

  it("an explicit mode overrides the profiler's inference", async () => {
    fetchReturning('{"total":100}');
    const providers: Providers = {
      // Profiler says "conversational" but the caller forces "task".
      profiler: new MockProvider([profilerHandler(CONVERSATIONAL_PROFILE)]),
      toolMocker: new MockProvider([]),
      scenarioGen: new MockProvider([
        (req) =>
          req.system.includes("procesan documentos")
            ? JSON.stringify({ cases: [{ title: "F1", document: "doc", expected: "e" }] })
            : null,
      ]),
      userSim: new MockProvider([() => "unused"]),
      judge: new MockProvider([
        (req) =>
          req.system.includes("binary pass/fail")
            ? JSON.stringify({ items: [{ criterion: "c" }] })
            : JSON.stringify({ pass: true, failedCriteria: [], rationale: "ok" }),
      ]),
      fixer: new MockProvider([() => JSON.stringify({ problem: "x", diff: "y", rationale: "z" })]),
      judgeModel: "m",
    };

    const result = await runEval(
      {
        connection: conn,
        agentSystemPrompt: "prompt",
        agentFamily: "openai",
        mode: "task",
        config: {
          scenarioCount: 1,
          mix: { happy_path: 1, edge_case: 0, adversarial: 0 },
          k: 1,
          maxTurns: 1,
          concurrency: 1,
        },
      },
      providers,
    );

    expect(result.ok).toBe(true);
    // Ran as task mode (matched the "procesan documentos" scenarioGen handler)
    // despite the profiler's own inference being conversational.
    if (result.ok) expect(result.value.totals.scenarios).toBe(1);
  });

  it("degrades gracefully when profiling fails, without breaking the run", async () => {
    fetchReturning("reply");
    const providers: Providers = {
      profiler: new MockProvider([]), // no handler → profiling fails
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

    const result = await runEval(
      {
        connection: conn,
        agentSystemPrompt: "prompt",
        agentFamily: "openai",
        config: {
          scenarioCount: 1,
          mix: { happy_path: 1, edge_case: 0, adversarial: 0 },
          k: 1,
          maxTurns: 1,
          concurrency: 1,
        },
      },
      providers,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profile.modeConfidence).toBe("low");
    expect(result.value.profile.mode).toBe("conversational"); // historical default
    expect(result.value.totals.scenarios).toBe(1); // run still completes
  });
});
