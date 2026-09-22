import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_LINE_BYTES = 4 * 1024 * 1024;

export type CodexBridgeError =
  | { kind: "not_installed"; message: string }
  | { kind: "not_authenticated"; message: string }
  | { kind: "unsupported_auth"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "protocol"; message: string }
  | { kind: "server"; message: string }
  | { kind: "closed"; message: string };

export type CodexResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CodexBridgeError };

export interface CodexAccount {
  accountId: string;
  email: string | null;
  planType: string | null;
}

export interface CodexCompletionInput {
  model: string;
  prompt: string;
  cwd: string;
  outputSchema?: Record<string, unknown>;
}

interface JsonObject {
  [key: string]: unknown;
}

interface JsonRpcNotification {
  method: string;
  params: unknown;
}

export interface CodexAppServerTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  subscribe(listener: (notification: JsonRpcNotification) => void): () => void;
  close(): Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexAppServerClientOptions {
  transport?: CodexAppServerTransport;
  timeoutMs?: number;
  clientVersion?: string;
}

export class CodexAppServerClient {
  private readonly transport: CodexAppServerTransport;
  private readonly timeoutMs: number;
  private readonly completionQueue: Promise<void> = Promise.resolve();
  private nextCompletion: Promise<void>;

  constructor(transport: CodexAppServerTransport, options: Omit<CodexAppServerClientOptions, "transport"> = {}) {
    this.transport = transport;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nextCompletion = this.completionQueue;
  }

  async initialize(clientVersion = "0.1.0"): Promise<CodexResult<void>> {
    try {
      await this.transport.request("initialize", {
        clientInfo: {
          name: "gauntlet",
          title: "Gauntlet",
          version: clientVersion,
        },
      });
      this.transport.notify("initialized", {});
      return { ok: true, value: undefined };
    } catch (error: unknown) {
      return { ok: false, error: classifyTransportError(error) };
    }
  }

  async readAccount(): Promise<CodexResult<CodexAccount>> {
    try {
      const result = await this.transport.request("account/read", { refreshToken: false });
      return parseAccount(result);
    } catch (error: unknown) {
      return { ok: false, error: classifyTransportError(error) };
    }
  }

  async complete(input: CodexCompletionInput): Promise<CodexResult<string>> {
    const result = this.nextCompletion.then(() => this.completeSerial(input), () => this.completeSerial(input));
    this.nextCompletion = result.then(() => undefined, () => undefined);
    return result;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private async completeSerial(input: CodexCompletionInput): Promise<CodexResult<string>> {
    let threadId: string | null = null;
    let unsubscribe: (() => void) | null = null;
    try {
      const threadResult = await this.transport.request("thread/start", {
        model: input.model,
        cwd: input.cwd,
        approvalPolicy: "never",
        sandbox: "readOnly",
        serviceName: "gauntlet",
      });
      threadId = stringAt(objectAt(threadResult, "thread")?.id);
      if (!threadId) return { ok: false, error: { kind: "protocol", message: "Codex no devolvió un thread válido" } };

      const completion = waitForTurn(this.transport, threadId, this.timeoutMs);
      unsubscribe = completion.unsubscribe;
      const turnResult = await this.transport.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
        cwd: input.cwd,
        approvalPolicy: "never",
        sandboxPolicy: {
          type: "readOnly",
          access: { type: "restricted", includePlatformDefaults: true, readableRoots: [input.cwd] },
          networkAccess: false,
        },
        model: input.model,
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      });
      const turnId = stringAt(objectAt(turnResult, "turn")?.id);
      if (!turnId) return { ok: false, error: { kind: "protocol", message: "Codex no devolvió un turn válido" } };
      return await completion.result;
    } catch (error: unknown) {
      return { ok: false, error: classifyTransportError(error) };
    } finally {
      unsubscribe?.();
      if (threadId) {
        await this.transport.request("thread/delete", { threadId }).catch(() => undefined);
      }
    }
  }
}

export async function createCodexAppServerClient(
  options: CodexAppServerClientOptions = {},
): Promise<CodexResult<CodexAppServerClient>> {
  try {
    const transport = options.transport ?? await createStdioTransport();
    const client = new CodexAppServerClient(transport, options);
    const initialized = await client.initialize(options.clientVersion);
    if (!initialized.ok) {
      await client.close().catch(() => undefined);
      return initialized;
    }
    return { ok: true, value: client };
  } catch (error: unknown) {
    return { ok: false, error: classifyTransportError(error) };
  }
}

let sharedClient: Promise<CodexResult<CodexAppServerClient>> | null = null;

export function getCodexAppServerClient(): Promise<CodexResult<CodexAppServerClient>> {
  sharedClient ??= createCodexAppServerClient();
  return sharedClient;
}

export async function resetCodexAppServerClient(): Promise<void> {
  const current = sharedClient;
  sharedClient = null;
  if (!current) return;
  const result = await current;
  if (result.ok) await result.value.close().catch(() => undefined);
}

function waitForTurn(
  transport: CodexAppServerTransport,
  threadId: string,
  timeoutMs: number,
): { result: Promise<CodexResult<string>>; unsubscribe: () => void } {
  let output = "";
  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let resolveResult: (result: CodexResult<string>) => void = () => undefined;
  const result = new Promise<CodexResult<string>>((resolve) => { resolveResult = resolve; });
  const finish = (value: CodexResult<string>): void => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolveResult(value);
  };
  const unsubscribe = transport.subscribe((notification) => {
    const params = objectValue(notification.params);
    if (stringAt(params?.threadId) !== threadId) return;
    if (notification.method === "item/agentMessage/delta") {
      const delta = stringAt(params?.delta) ?? stringAt(params?.text);
      if (delta) output += delta;
      return;
    }
    if (notification.method !== "turn/completed") return;
    const turn = objectValue(params?.turn);
    const status = stringAt(turn?.status);
    if (status !== "completed") {
      finish({ ok: false, error: { kind: "server", message: "Codex no pudo completar el turno" } });
      return;
    }
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const finalItem = items.find((item) => {
      const object = objectValue(item);
      return object?.type === "agentMessage" && typeof object.text === "string";
    });
    const finalText = stringAt(objectValue(finalItem)?.text) ?? output;
    finish(finalText.trim()
      ? { ok: true, value: finalText.trim() }
      : { ok: false, error: { kind: "server", message: "Codex devolvió una respuesta vacía" } });
  });
  timeout = setTimeout(() => finish({ ok: false, error: { kind: "timeout", message: "Codex agotó el tiempo de respuesta" } }), timeoutMs);
  return { result, unsubscribe: () => { unsubscribe(); if (timeout) clearTimeout(timeout); } };
}

async function createStdioTransport(): Promise<CodexAppServerTransport> {
  const command = process.env.GAUNTLET_CODEX_BIN?.trim() || "codex";
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(command, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    throw new Error("codex executable is not installed");
  }
  return new StdioTransport(child);
}

class StdioTransport implements CodexAppServerTransport {
  private readonly lineReader: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(notification: JsonRpcNotification) => void>();
  private nextId = 1;
  private closed = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.lineReader = createInterface({ input: child.stdout });
    this.lineReader.on("line", (line) => this.handleLine(line));
    child.on("exit", () => this.failPending(new Error("codex app-server exited")));
    child.on("error", () => this.failPending(new Error("codex app-server could not start")));
    child.stderr.on("data", () => undefined);
  }

  request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("codex app-server is closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("codex app-server request timed out"));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ method, id, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (!this.closed) this.write({ method, params });
  }

  subscribe(listener: (notification: JsonRpcNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lineReader.close();
    this.failPending(new Error("codex app-server closed"));
    if (!this.child.killed) this.child.kill();
  }

  private write(message: JsonObject): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      this.failPending(new Error("codex app-server message too large"));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      this.failPending(new Error("codex app-server returned invalid JSON"));
      return;
    }
    const object = objectValue(parsed);
    if (!object) return;
    const id = numberAt(object.id);
    if (id !== null && this.pending.has(id)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const error = objectValue(object.error);
      if (error) pending.reject(new Error("codex app-server request failed"));
      else pending.resolve(object.result);
      return;
    }
    const method = stringAt(object.method);
    if (id !== null && method) {
      this.write({ id, error: { code: -32000, message: "Gauntlet no admite requests interactivos de Codex" } });
      return;
    }
    if (!method) return;
    const notification: JsonRpcNotification = { method, params: object.params };
    for (const listener of this.listeners) listener(notification);
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function parseAccount(value: unknown): CodexResult<CodexAccount> {
  const account = objectValue(objectValue(value)?.account);
  if (!account) return { ok: false, error: { kind: "not_authenticated", message: "Codex no tiene una sesión activa" } };
  const type = stringAt(account.type);
  if (type !== "chatgpt") return { ok: false, error: { kind: "unsupported_auth", message: "Codex no está autenticado con una suscripción de ChatGPT" } };
  const email = stringAt(account.email);
  return {
    ok: true,
    value: {
      accountId: email ?? "chatgpt",
      email,
      planType: stringAt(account.planType),
    },
  };
}

function classifyTransportError(error: unknown): CodexBridgeError {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("not installed") || message.includes("enoent") || message.includes("could not start")) return { kind: "not_installed", message: "Codex CLI no está instalado o no se pudo iniciar" };
  if (message.includes("timed out")) return { kind: "timeout", message: "Codex agotó el tiempo de respuesta" };
  if (message.includes("closed") || message.includes("exited")) return { kind: "closed", message: "El bridge de Codex se cerró" };
  if (message.includes("request failed")) return { kind: "server", message: "Codex rechazó la solicitud" };
  return { kind: "protocol", message: "No se pudo comunicar con Codex" };
}

function objectValue(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function objectAt(value: unknown, key: string): JsonObject | null {
  return objectValue(objectValue(value)?.[key]);
}

function stringAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberAt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
