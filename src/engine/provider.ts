import Anthropic from "@anthropic-ai/sdk";
import { CopilotClient } from "@github/copilot-sdk";
import { createHash } from "node:crypto";
import type { EngineResult } from "./types";
import { estimateTokenCount } from "@/server/subscription-logic";
import { recordUsage } from "@/server/subscription-store";
import type { UsageLedgerEntry } from "@/server/subscription-types";

export interface CompletionRequest {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  jsonSchema?: Record<string, unknown>;
}

export interface LlmProvider {
  readonly family: "anthropic" | "openai" | "copilot" | "codex" | "mock";
  complete(req: CompletionRequest): Promise<EngineResult<string>>;
}

export interface CopilotSessionLike {
  sendAndWait(input: { prompt: string }, timeout?: number): Promise<{ data: { content: string; outputTokens?: number } } | undefined>;
  disconnect(): Promise<void>;
}

export interface CopilotClientLike {
  start(): Promise<void>;
  createSession(input: { model: string; systemMessage: { mode: "replace"; content: string } }): Promise<CopilotSessionLike>;
  stop(): Promise<void>;
}

export interface CopilotProviderOptions {
  token: string;
  workspaceId: string;
  connectionId: string;
  runId?: string;
  createClient?: (token: string) => CopilotClientLike;
  recordUsage?: (entry: Omit<UsageLedgerEntry, "id">) => Promise<unknown>;
  timeoutMs?: number;
}

export class CopilotProvider implements LlmProvider {
  readonly family = "copilot" as const;
  private readonly options: CopilotProviderOptions;

  constructor(options: CopilotProviderOptions) {
    this.options = options;
  }

  async complete(req: CompletionRequest): Promise<EngineResult<string>> {
    const inputText = [req.system, ...req.messages.map((message) => message.content)].join("\n");
    const inputEstimate = estimateTokenCount(inputText);
    const requestKey = `${this.options.runId ?? "adhoc"}:${sha256(`${req.model}\n${inputText}`)}`;
    const createClient = this.options.createClient ?? defaultCopilotClient;
    const record = this.options.recordUsage ?? recordUsage;
    let client: CopilotClientLike | null = null;
    let session: CopilotSessionLike | null = null;
    let output = "";
    let outputTokens: number | undefined;
    let error: { kind: "provider_error" | "provider_rate_limited"; message: string } | null = null;
    try {
      client = createClient(this.options.token);
      await client.start();
      session = await client.createSession({
        model: req.model,
        systemMessage: { mode: "replace", content: req.system },
      });
      const prompt = formatPrompt(req);
      const response = await session.sendAndWait({ prompt }, this.options.timeoutMs ?? 120_000);
      output = response?.data.content.trim() ?? "";
      outputTokens = response?.data.outputTokens;
      if (!output) error = { kind: "provider_error", message: "subscription provider returned an empty response" };
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message.toLowerCase() : "";
      error = message.includes("429") || message.includes("rate limit") || message.includes("quota")
        ? { kind: "provider_rate_limited", message: "subscription provider rate limit exceeded" }
        : { kind: "provider_error", message: "subscription provider request failed" };
    } finally {
      if (session) await session.disconnect().catch(() => {});
      if (client) await client.stop().catch(() => {});
      const outputEstimate = estimateTokenCount(output);
      await record({
        workspaceId: this.options.workspaceId,
        connectionId: this.options.connectionId,
        runId: this.options.runId ?? null,
        requestKey,
        model: req.model,
        status: error ? "error" : "completed",
        inputTokens: inputEstimate.count,
        outputTokens: outputTokens ?? outputEstimate.count,
        tokenSource: outputTokens === undefined ? "estimated" : "provider",
        error: error?.message ?? null,
        createdAt: Date.now(),
        completedAt: Date.now(),
      }).catch(() => {});
    }
    return error ? { ok: false, error } : { ok: true, value: output };
  }
}

function defaultCopilotClient(token: string): CopilotClientLike {
  const client = new CopilotClient({ mode: "empty", gitHubToken: token, useLoggedInUser: false, logLevel: "error" });
  return {
    start: () => client.start(),
    createSession: (input) => client.createSession(input),
    stop: async () => { await client.stop(); },
  };
}

function formatPrompt(req: CompletionRequest): string {
  const transcript = req.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  const schema = req.jsonSchema ? `\nRespond as JSON matching this schema:\n${JSON.stringify(req.jsonSchema)}` : "";
  return `${transcript}${schema}`.trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export class AnthropicProvider implements LlmProvider {
  readonly family = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey?: string) {
    // Higher retry budget than the SDK default (2): a 50×k run fires hundreds
    // of LLM calls and will brush rate limits; the SDK backs off 429/5xx for us.
    const opts = { maxRetries: 5 };
    this.client = apiKey ? new Anthropic({ apiKey, ...opts }) : new Anthropic(opts);
  }

  async complete(req: CompletionRequest): Promise<EngineResult<string>> {
    try {
      const response = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        ...(req.jsonSchema
          ? {
              output_config: {
                format: {
                  type: "json_schema" as const,
                  schema: req.jsonSchema,
                },
              },
            }
          : {}),
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) {
        return {
          ok: false,
          error: {
            kind: "provider_error",
            message: `Empty response (stop_reason: ${response.stop_reason})`,
          },
        };
      }
      return { ok: true, value: text };
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        return {
          ok: false,
          error: { kind: "provider_rate_limited", message: "provider rate limit exceeded" },
        };
      }
      if (error instanceof Anthropic.APIError) {
        return {
          ok: false,
          error: {
            kind: "provider_error",
            message: `provider API error (HTTP ${error.status})`,
          },
        };
      }
      return {
        ok: false,
        error: {
          kind: "provider_error",
          message: "provider request failed",
        },
      };
    }
  }
}

const OPENAI_RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

/**
 * OpenAI-compatible provider, reached over plain fetch (no extra SDK). Its
 * reason for existing is the judge: judging an Anthropic-family agent with an
 * Anthropic-family judge invites self-preference bias, so the judge must be
 * able to come from a different family. Points at any OpenAI-shaped base URL,
 * so OpenAI, Azure, a gateway or a local model all work.
 */
export class OpenAiProvider implements LlmProvider {
  readonly family = "openai" as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
      .replace(/\/+$/, "");
  }

  async complete(req: CompletionRequest): Promise<EngineResult<string>> {
    // ponytail: json_object mode + the engine's existing forgiving extractJson,
    // rather than strict json_schema — strict mode rejects schemas that don't
    // list every property as required, and varies across OpenAI-compatible
    // gateways. Upgrade to json_schema if a model is seen drifting off-shape.
    const body = {
      model: req.model,
      max_completion_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        ...req.messages,
      ],
      ...(req.jsonSchema ? { response_format: { type: "json_object" as const } } : {}),
    };

    let lastError = "";
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        const backoffMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        lastError = `HTTP ${response.status}`;
        lastStatus = response.status;
        if (OPENAI_RETRYABLE.has(response.status)) continue;
        return {
          ok: false,
          error: { kind: "provider_error", message: `OpenAI ${lastError}` },
        };
      }

      const json = (await response.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
      } | null;
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        lastError = "empty response";
        continue;
      }
      return { ok: true, value: text };
    }

    // Retries exhausted. Keep rate limiting distinguishable from a hard error:
    // the runner degrades a single conversation on the latter, but a sustained
    // 429 means the whole run is going too fast.
    return {
      ok: false,
      error: {
        kind: lastStatus === 429 ? "provider_rate_limited" : "provider_error",
        message: `OpenAI request failed after retries: ${lastError}`,
      },
    };
  }
}

/**
 * Deterministic provider for tests and the built-in demo. Responses are
 * routed by inspecting the system prompt role markers the engine embeds.
 */
export class MockProvider implements LlmProvider {
  readonly family = "mock" as const;
  private handlers: ((req: CompletionRequest) => string | null)[];

  constructor(handlers: ((req: CompletionRequest) => string | null)[] = []) {
    this.handlers = handlers;
  }

  addHandler(handler: (req: CompletionRequest) => string | null): void {
    this.handlers.push(handler);
  }

  async complete(req: CompletionRequest): Promise<EngineResult<string>> {
    for (const handler of this.handlers) {
      const result = handler(req);
      if (result !== null) return { ok: true, value: result };
    }
    return {
      ok: false,
      error: {
        kind: "provider_error",
        message: `MockProvider: no handler matched (system starts: ${req.system.slice(0, 60)})`,
      },
    };
  }
}

export const MODELS = {
  profiler: "claude-sonnet-5",
  scenarioGen: "claude-sonnet-5",
  userSim: "claude-haiku-4-5",
  toolMocker: "claude-haiku-4-5",
  judge: "claude-sonnet-5",
  fixer: "claude-sonnet-5",
} as const;

/** Judge model used when an OpenAI-family judge is available. Overridable
 * because the right model name depends on the account and base URL in use. */
export const OPENAI_JUDGE_MODEL = process.env.GAUNTLET_OPENAI_JUDGE_MODEL ?? "gpt-4.1";
