import { describe, expect, it } from "vitest";
import { CodexAppServerClient, type CodexAppServerTransport } from "@/server/codex-app-server";

class FakeTransport implements CodexAppServerTransport {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  private listeners = new Set<(notification: { method: string; params: unknown }) => void>();
  account: unknown = { account: { type: "chatgpt", email: "isidro@example.com", planType: "pro" } };

  async request(method: string, params: unknown = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "account/read") return this.account;
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      queueMicrotask(() => this.emit("item/agentMessage/delta", { threadId: "thread-1", delta: "respuesta" }));
      queueMicrotask(() => this.emit("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } }));
      return { turn: { id: "turn-1", status: "inProgress" } };
    }
    return {};
  }

  notify(method: string, params: unknown = {}): void {
    this.requests.push({ method, params });
  }

  subscribe(listener: (notification: { method: string; params: unknown }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {}

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners) listener({ method, params });
  }
}

describe("Codex App Server client", () => {
  it("initializes, reads ChatGPT auth and completes without exposing credentials", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport, { timeoutMs: 100 });
    expect(await client.initialize("test")).toEqual({ ok: true, value: undefined });
    expect(await client.readAccount()).toEqual({
      ok: true,
      value: { accountId: "isidro@example.com", email: "isidro@example.com", planType: "pro" },
    });
    expect(await client.complete({ model: "gpt-5", prompt: "hola", cwd: "/tmp" })).toEqual({ ok: true, value: "respuesta" });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize", "initialized", "account/read", "thread/start", "turn/start", "thread/delete",
    ]);
    expect(JSON.stringify(transport.requests)).not.toContain("auth.json");
  });

  it("rejects API-key auth and missing accounts", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    transport.account = { account: { type: "apiKey" } };
    expect((await client.readAccount()).ok).toBe(false);
    transport.account = { account: null };
    expect(await client.readAccount()).toEqual({ ok: false, error: { kind: "not_authenticated", message: "Codex no tiene una sesión activa" } });
  });

  it("serializes completions on one app-server process", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport, { timeoutMs: 100 });
    const results = await Promise.all([
      client.complete({ model: "gpt-5", prompt: "uno", cwd: "/tmp" }),
      client.complete({ model: "gpt-5", prompt: "dos", cwd: "/tmp" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(transport.requests.filter((request) => request.method === "turn/start")).toHaveLength(2);
  });

  it("returns a bounded timeout when the turn never completes", async () => {
    const transport = new FakeTransport();
    transport.request = async (method: string, params: unknown = {}) => {
      transport.requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-timeout" } };
      if (method === "turn/start") return { turn: { id: "turn-timeout", status: "inProgress" } };
      return {};
    };
    const client = new CodexAppServerClient(transport, { timeoutMs: 5 });
    await expect(client.complete({ model: "gpt-5", prompt: "timeout", cwd: "/tmp" })).resolves.toEqual({
      ok: false,
      error: { kind: "timeout", message: "Codex agotó el tiempo de respuesta" },
    });
  });
});
