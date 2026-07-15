import { afterEach, describe, expect, it } from "vitest";
import { mockToolResult, runAgentTurn } from "@/engine/tool-loop";
import { simulateConversation } from "@/engine/simulator";
import { MockProvider, type CompletionRequest } from "@/engine/provider";
import type { AgentConnection } from "@/engine/connector";
import type { Scenario, ToolDefinition, Turn } from "@/engine/types";

const conn: AgentConnection = {
  endpointUrl: "http://127.0.0.1:9/v1/chat/completions",
  protocol: "openai",
  authType: "none",
};

const scenario: Scenario = {
  id: "s1",
  category: "happy_path",
  title: "t",
  persona: "p",
  objective: "consultar el clima",
  successCriteria: "responde con el clima correcto",
  maxTurns: 4,
};

const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Devuelve el clima de una ciudad",
  parameters: { type: "object", properties: { city: { type: "string" } } },
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function toolCallsResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function messageResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("mockToolResult", () => {
  it("returns the provider's synthesized result", async () => {
    const provider = new MockProvider([() => '{"temp": 72, "conditions": "sunny"}']);
    const r = await mockToolResult(provider, "m", weatherTool, '{"city":"NYC"}', scenario);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain("72");
  });
});

describe("runAgentTurn", () => {
  it("resolves immediately when the agent replies with a plain message (no tools)", async () => {
    globalThis.fetch = (async () => messageResponse("Hola, ¿en qué te ayudo?")) as typeof fetch;
    const toolProvider = new MockProvider([]); // never called — no tool_calls happen
    const history: Turn[] = [{ role: "user", content: "hola" }];
    const r = await runAgentTurn(conn, history, [], toolProvider, "m", scenario, "s1", 6);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]).toEqual({ role: "assistant", content: "Hola, ¿en qué te ayudo?" });
    }
  });

  it("negotiates one tool round-trip then returns the final message", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      return call === 1 ? toolCallsResponse() : messageResponse("En NYC hace 72°F y está soleado.");
    }) as typeof fetch;

    const toolProvider = new MockProvider([() => '{"temp": 72, "conditions": "sunny"}']);
    const history: Turn[] = [{ role: "user", content: "¿Qué clima hace en NYC?" }];
    const r = await runAgentTurn(conn, history, [weatherTool], toolProvider, "m", scenario, "s1", 6);

    expect(r.ok).toBe(true);
    if (r.ok) {
      // [tool call+result turn, final assistant message]
      expect(r.value).toHaveLength(2);
      expect(r.value[0]!.role).toBe("tool");
      expect(r.value[0]!.content).toContain("get_weather");
      expect(r.value[0]!.content).toContain("72");
      expect(r.value[1]).toEqual({ role: "assistant", content: "En NYC hace 72°F y está soleado." });
    }
  });

  it("mocks a plausible result even for a tool the user never declared", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      return call === 1 ? toolCallsResponse() : messageResponse("listo");
    }) as typeof fetch;

    const toolProvider = new MockProvider([() => "resultado genérico"]);
    const history: Turn[] = [{ role: "user", content: "hola" }];
    // No tools declared at all — get_weather is undeclared but still gets mocked.
    const r = await runAgentTurn(conn, history, [], toolProvider, "m", scenario, "s1", 6);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]!.content).toContain("get_weather");
  });

  it("returns tool_loop_exceeded when the agent never stops calling tools", async () => {
    globalThis.fetch = (async () => toolCallsResponse()) as typeof fetch;
    const toolProvider = new MockProvider([() => "resultado"]);
    const history: Turn[] = [{ role: "user", content: "hola" }];
    const r = await runAgentTurn(conn, history, [weatherTool], toolProvider, "m", scenario, "s1", 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("tool_loop_exceeded");
  });

  it("surfaces a connector failure (e.g. unreachable agent) as an error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const toolProvider = new MockProvider([]);
    const r = await runAgentTurn(conn, [{ role: "user", content: "hi" }], [], toolProvider, "m", scenario, "s1", 6);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("connector_unreachable");
  });
});

describe("simulateConversation with tools", () => {
  it("hides tool activity from the simulated user but keeps it in the full transcript", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      // Every agent turn does one tool round-trip before answering.
      return call % 2 === 1 ? toolCallsResponse() : messageResponse("En NYC hace 72°F y está soleado.");
    }) as typeof fetch;

    let sawToolNoise = false;
    const userSim = new MockProvider([
      (req: CompletionRequest) => {
        if (req.messages.some((m) => m.content.includes("🔧"))) sawToolNoise = true;
        // First turn: ask the question. Second turn: stop.
        const askedAlready = req.messages.some((m) => m.role === "assistant");
        return askedAlready ? "###END###" : "¿Qué clima hace en NYC?";
      },
    ]);
    const toolProvider = new MockProvider([() => '{"temp": 72, "conditions": "sunny"}']);

    const result = await simulateConversation(
      userSim,
      "m",
      conn,
      { ...scenario, maxTurns: 3 },
      "s1",
      [weatherTool],
      toolProvider,
      "m",
      6,
    );

    expect(result.ok).toBe(true);
    expect(sawToolNoise).toBe(false); // the user-sim never saw the 🔧 tool turns
    if (result.ok) {
      // But the full transcript (used by the judge) has them.
      expect(result.value.some((t) => t.role === "tool")).toBe(true);
    }
  });
});
