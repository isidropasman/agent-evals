import { describe, expect, it } from "vitest";
import { CopilotProvider, type CopilotClientLike } from "@/engine/provider";
import { CodexProvider } from "@/server/codex-provider";
import { CodexAppServerClient, type CodexAppServerTransport } from "@/server/codex-app-server";

describe("CopilotProvider", () => {
  it("preserves the system prompt and records one usage entry", async () => {
    const prompts: string[] = [];
    const systemMessages: string[] = [];
    const usage: { inputTokens: number; outputTokens: number; requestKey: string }[] = [];
    const session = {
      sendAndWait: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return { data: { content: "respuesta", outputTokens: 7 } };
      },
      disconnect: async () => {},
    };
    const client: CopilotClientLike = {
      start: async () => {},
      createSession: async (input) => {
        systemMessages.push(input.systemMessage.content);
        return session;
      },
      stop: async () => {},
    };
    const provider = new CopilotProvider({
      token: "gho_secret",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      runId: "run-1",
      createClient: () => client,
      recordUsage: async (entry) => {
        usage.push({ inputTokens: entry.inputTokens, outputTokens: entry.outputTokens, requestKey: entry.requestKey });
      },
    });

    const result = await provider.complete({
      model: "gpt-5",
      system: "Sos un juez estricto",
      messages: [{ role: "user", content: "Evaluá esto" }],
      maxTokens: 200,
    });

    expect(result).toEqual({ ok: true, value: "respuesta" });
    expect(systemMessages[0]).toBe("Sos un juez estricto");
    expect(prompts[0]).toContain("Evaluá esto");
    expect(usage).toHaveLength(1);
    expect(usage[0]?.outputTokens).toBe(7);
    expect(usage[0]?.requestKey).toContain("run-1");
  });

  it("returns a safe provider error and still disconnects on SDK failure", async () => {
    let disconnected = false;
    const client: CopilotClientLike = {
      start: async () => {},
      createSession: async () => ({
        sendAndWait: async () => { throw new Error("secret provider payload"); },
        disconnect: async () => { disconnected = true; },
      }),
      stop: async () => {},
    };
    const provider = new CopilotProvider({ token: "gho_secret", workspaceId: "w", connectionId: "c", createClient: () => client });
    const result = await provider.complete({ model: "gpt-5", system: "s", messages: [], maxTokens: 10 });
    expect(result).toEqual({ ok: false, error: { kind: "provider_error", message: "subscription provider request failed" } });
    expect(disconnected).toBe(true);
  });
});

describe("CodexProvider", () => {
  it("uses the local app-server and records estimated usage without token material", async () => {
    let listener: ((notification: { method: string; params: unknown }) => void) | null = null;
    const transport: CodexAppServerTransport = {
      request: async (method) => {
        if (method === "account/read") return { account: { type: "chatgpt", email: "test@example.com", planType: "plus" } };
        if (method === "thread/start") return { thread: { id: "thread-1" } };
        if (method === "turn/start") {
          queueMicrotask(() => listener?.({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [{ type: "agentMessage", text: "ok" }] } } }));
          return { turn: { id: "turn-1" } };
        }
        return {};
      },
      notify: () => {},
      subscribe: (next) => {
        listener = next;
        return () => { listener = null; };
      },
      close: async () => {},
    };
    const client = new CodexAppServerClient(transport, { timeoutMs: 100 });
    const usage: Array<{ requestKey: string; tokenSource: string }> = [];
    const provider = new CodexProvider({
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      runId: "run-1",
      client,
      recordUsage: async (entry) => { usage.push({ requestKey: entry.requestKey, tokenSource: entry.tokenSource }); },
    });
    const result = await provider.complete({ model: "gpt-5", system: "sistema", messages: [{ role: "user", content: "hola" }], maxTokens: 100 });
    expect(result).toEqual({ ok: true, value: "ok" });
    expect(usage).toEqual([{ requestKey: expect.stringContaining("run-1:"), tokenSource: "estimated" }]);
  });
});
