import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LlmProvider, CompletionRequest } from "@/engine/provider";
import type { EngineResult } from "@/engine/types";
import { estimateTokenCount } from "./subscription-logic";
import { recordUsage } from "./subscription-store";
import {
  getCodexAppServerClient,
  type CodexAppServerClient,
  type CodexBridgeError,
  type CodexResult,
} from "./codex-app-server";
import type { UsageLedgerEntry } from "./subscription-types";

export interface CodexProviderOptions {
  workspaceId: string;
  connectionId: string;
  runId?: string;
  cwd?: string;
  client?: CodexAppServerClient;
  getClient?: () => Promise<{ ok: true; value: CodexAppServerClient } | { ok: false; error: CodexBridgeError }>;
  recordUsage?: (entry: Omit<UsageLedgerEntry, "id">) => Promise<unknown>;
}

export class CodexProvider implements LlmProvider {
  readonly family = "codex" as const;
  private accountCheck: Promise<CodexResult<CodexAppServerClient>> | null = null;

  constructor(private readonly options: CodexProviderOptions) {}

  async complete(req: CompletionRequest): Promise<EngineResult<string>> {
    const inputText = [req.system, ...req.messages.map((message) => `${message.role}: ${message.content}`)].join("\n");
    const requestKey = `${this.options.runId ?? "adhoc"}:${sha256(`${req.model}\n${inputText}`)}`;
    const inputEstimate = estimateTokenCount(inputText);
    const record = this.options.recordUsage ?? recordUsage;
    let output = "";
    let error: { kind: "provider_error" | "provider_rate_limited"; message: string } | null = null;
    try {
      const client = this.options.client
        ? { ok: true as const, value: this.options.client }
        : await (this.options.getClient ?? getCodexAppServerClient)();
      if (!client.ok) {
        error = toProviderError(client.error);
      } else {
        this.accountCheck ??= verifyChatGptAccount(client.value);
        const account = await this.accountCheck;
        if (!account.ok) {
          error = toProviderError(account.error);
        } else {
          const response = await client.value.complete({
            model: req.model,
            prompt: formatPrompt(req),
            cwd: this.options.cwd ?? safeCodexCwd(),
            ...(req.jsonSchema ? { outputSchema: req.jsonSchema } : {}),
          });
          if (!response.ok) error = toProviderError(response.error);
          else {
            output = response.value.trim();
            if (!output) error = { kind: "provider_error", message: "subscription provider returned an empty response" };
          }
        }
      }
    } catch {
      error = { kind: "provider_error", message: "subscription provider request failed" };
    }
    const outputEstimate = estimateTokenCount(output);
    await record({
      workspaceId: this.options.workspaceId,
      connectionId: this.options.connectionId,
      runId: this.options.runId ?? null,
      requestKey,
      model: req.model,
      status: error ? "error" : "completed",
      inputTokens: inputEstimate.count,
      outputTokens: outputEstimate.count,
      tokenSource: "estimated",
      error: error?.message ?? null,
      createdAt: Date.now(),
      completedAt: Date.now(),
    }).catch(() => undefined);
    return error ? { ok: false, error } : { ok: true, value: output };
  }
}

async function verifyChatGptAccount(client: CodexAppServerClient): Promise<CodexResult<CodexAppServerClient>> {
  const account = await client.readAccount();
  return account.ok ? { ok: true, value: client } : account;
}

function formatPrompt(req: CompletionRequest): string {
  const schema = req.jsonSchema ? `\nRespond as JSON matching this schema:\n${JSON.stringify(req.jsonSchema)}` : "";
  const messages = req.messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  return `SYSTEM: ${req.system}\n\n${messages}${schema}`.trim();
}

function toProviderError(error: CodexBridgeError): { kind: "provider_error" | "provider_rate_limited"; message: string } {
  if (error.kind === "server" && /limit|quota/i.test(error.message)) return { kind: "provider_rate_limited", message: "subscription provider rate limit exceeded" };
  return { kind: "provider_error", message: "subscription provider request failed" };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function safeCodexCwd(): string {
  const cwd = path.join(tmpdir(), "gauntlet-codex");
  mkdirSync(cwd, { recursive: true });
  return cwd;
}
