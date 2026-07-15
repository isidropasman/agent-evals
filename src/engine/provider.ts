import Anthropic from "@anthropic-ai/sdk";
import type { EngineResult } from "./types";

export interface CompletionRequest {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  jsonSchema?: Record<string, unknown>;
}

export interface LlmProvider {
  readonly family: "anthropic" | "openai" | "mock";
  complete(req: CompletionRequest): Promise<EngineResult<string>>;
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
          error: { kind: "provider_rate_limited", message: error.message },
        };
      }
      if (error instanceof Anthropic.APIError) {
        return {
          ok: false,
          error: {
            kind: "provider_error",
            message: `API error ${error.status}: ${error.message}`,
          },
        };
      }
      return {
        ok: false,
        error: {
          kind: "provider_error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
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
