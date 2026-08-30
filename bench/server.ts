import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { FIXTURES, fixtureById, type FixtureMessage } from "./fixtures";

/**
 * One HTTP server hosting every reference agent, OpenAI-compatible, at
 * /agent/<fixtureId>.
 *
 * Two layers per fixture:
 *  - a real LLM backing, so the agent behaves like an agent and the control's
 *    false-positive rate means something;
 *  - a deterministic defect layer that fires on trigger and is recorded, so
 *    "the defect happened in this conversation" is ground truth rather than an
 *    inference.
 */

export interface DefectHit {
  fixtureId: string;
  defectId: string;
  /** Gauntlet's per-conversation id — `${scenarioId}-a${attempt}`. */
  sessionId: string;
}

const BACKING_MODEL = "claude-haiku-4-5";

export interface BenchServer {
  port: number;
  hits(): DefectHit[];
  reset(): void;
  close(): Promise<void>;
}

/** Anthropic requires user/assistant alternation starting with user; the wire
 * history can contain tool roles and consecutive same-role entries. */
function normalize(messages: FixtureMessage[]): { role: "user" | "assistant"; content: string }[] {
  const mapped = messages
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content:
        m.role === "tool"
          ? `[resultado de herramienta] ${m.content ?? ""}`
          : (m.content ?? ""),
    }))
    .filter((m) => m.content.trim().length > 0);

  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of mapped) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length > 0 && merged[0]?.role !== "user") merged.shift();
  return merged.length > 0 ? merged : [{ role: "user", content: "Hola" }];
}

export async function startBenchServer(opts: {
  apiKey?: string;
  /** Skip the LLM backing and answer with a canned line — lets the harness be
   * exercised without spending anything. */
  mock?: boolean;
  port?: number;
}): Promise<BenchServer> {
  const hits: DefectHit[] = [];
  const client = opts.apiKey && !opts.mock ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 5 }) : null;

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, payload: unknown): void => {
      const text = JSON.stringify(payload);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };

    if (url.pathname === "/health") return send(200, { ok: true, fixtures: FIXTURES.map((f) => f.id) });
    if (url.pathname === "/_defects") return send(200, { hits });
    if (url.pathname === "/_reset") {
      hits.length = 0;
      return send(200, { ok: true });
    }

    const match = /^\/agent\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match || req.method !== "POST") return send(404, { error: "not found" });

    const fixture = fixtureById(match[1] ?? "");
    if (!fixture) return send(404, { error: "unknown fixture" });

    const raw = await readBody(req);
    let body: { messages?: FixtureMessage[]; user?: string };
    try {
      body = JSON.parse(raw) as { messages?: FixtureMessage[]; user?: string };
    } catch {
      return send(400, { error: "invalid json" });
    }
    const messages = body.messages ?? [];
    const sessionId = typeof body.user === "string" ? body.user : "unknown";

    const wantsTool = fixture.toolCall?.(messages) ?? null;
    if (wantsTool) {
      return send(200, {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call_${fixture.id}_${hits.length}_${messages.length}`,
                  type: "function",
                  function: {
                    name: wantsTool.name,
                    arguments: JSON.stringify(wantsTool.args),
                  },
                },
              ],
            },
          },
        ],
      });
    }

    const defect = fixture.probe(messages);
    if (defect) {
      hits.push({ fixtureId: fixture.id, defectId: defect.defectId, sessionId });
      return send(200, {
        choices: [{ message: { role: "assistant", content: defect.content } }],
      });
    }

    if (!client) {
      return send(200, {
        choices: [
          {
            message: {
              role: "assistant",
              content:
                "Gracias por escribir. Puedo ayudarte con consultas sobre el servicio; si necesitás algo que no está a mi alcance, te derivo al equipo correspondiente.",
            },
          },
        ],
      });
    }

    try {
      const completion = await client.messages.create({
        model: BACKING_MODEL,
        max_tokens: 700,
        system: fixture.systemPrompt,
        messages: normalize(messages),
      });
      const content = completion.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return send(200, {
        choices: [{ message: { role: "assistant", content: content || "…" } }],
      });
    } catch (error) {
      return send(502, {
        error: error instanceof Error ? error.message : "backing model error",
      });
    }
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("could not determine bench server port"));
    });
  });

  return {
    port,
    hits: () => [...hits],
    reset: () => {
      hits.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
