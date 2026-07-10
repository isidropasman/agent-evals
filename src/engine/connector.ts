import type { EngineResult, Turn } from "./types";
import { assertAllowedUrl } from "./ssrf";

const MAX_RESPONSE_BYTES = 256 * 1024;

export interface AgentConnection {
  endpointUrl: string;
  authType: "none" | "bearer" | "header";
  authToken?: string;
  authHeaderName?: string;
  /** "openai" = POST /v1/chat/completions shape; "coval" = {sessionId, messages[]} shape */
  protocol: "openai" | "coval";
}

interface WireMessage {
  role: string;
  content: string;
}

function buildHeaders(conn: AgentConnection): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (conn.authType === "bearer" && conn.authToken) {
    headers["authorization"] = `Bearer ${conn.authToken}`;
  } else if (conn.authType === "header" && conn.authToken && conn.authHeaderName) {
    headers[conn.authHeaderName] = conn.authToken;
  }
  return headers;
}

export async function sendToAgent(
  conn: AgentConnection,
  transcript: Turn[],
  sessionId: string,
): Promise<EngineResult<string>> {
  const messages: WireMessage[] = transcript.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  const body =
    conn.protocol === "openai"
      ? JSON.stringify({ model: "agent", messages })
      : JSON.stringify({ sessionId, messages });

  // Re-validate on every request: the URL was checked at run creation, but
  // re-checking here narrows the DNS-rebinding window and covers any code path
  // that reaches the connector without going through the API boundary.
  const allowed = await assertAllowedUrl(conn.endpointUrl);
  if (!allowed.ok) return allowed;

  let response: Response;
  try {
    response = await fetch(conn.endpointUrl, {
      method: "POST",
      headers: buildHeaders(conn),
      body,
      redirect: "manual", // don't follow redirects into blocked ranges
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "connector_unreachable",
        message: `Could not reach agent at ${conn.endpointUrl}: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  // A redirect could point at an internal host we never got to validate.
  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      error: {
        kind: "connector_bad_response",
        message: `Agent endpoint returned a redirect (HTTP ${response.status}); agent endpoints must respond directly, not redirect.`,
      },
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: {
        kind: "connector_bad_response",
        message: `Agent returned HTTP ${response.status}: ${text.slice(0, 300)}`,
      },
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return {
      ok: false,
      error: {
        kind: "connector_bad_response",
        message: `Agent must return JSON (got content-type: ${contentType || "none"})`,
      },
    };
  }

  const raw = await readCapped(response);
  if (!raw.ok) return raw;

  let json: unknown;
  try {
    json = JSON.parse(raw.value);
  } catch {
    return {
      ok: false,
      error: {
        kind: "connector_bad_response",
        message: "Agent response was not valid JSON",
      },
    };
  }

  const reply = extractAssistantReply(json);
  if (reply === null) {
    return {
      ok: false,
      error: {
        kind: "connector_bad_response",
        message:
          "Could not find assistant reply in response. Expected OpenAI chat shape ({choices:[{message:{content}}]}) or Coval shape ({messages:[{role,content}]}).",
      },
    };
  }
  return { ok: true, value: reply };
}

/** Read a response body but abort past MAX_RESPONSE_BYTES so a hostile or
 * runaway endpoint can't exhaust memory. */
async function readCapped(response: Response): Promise<EngineResult<string>> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text().catch(() => "");
    if (text.length > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        error: { kind: "connector_bad_response", message: "Agent response too large" },
      };
    }
    return { ok: true, value: text };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return {
          ok: false,
          error: {
            kind: "connector_bad_response",
            message: `Agent response exceeded ${MAX_RESPONSE_BYTES} bytes`,
          },
        };
      }
      chunks.push(value);
    }
  }
  return { ok: true, value: new TextDecoder().decode(concat(chunks, total)) };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** One-shot reachability probe: sends a single benign message so onboarding /
 * run-preflight can fail fast with a clear reason instead of after N failed
 * conversations. Returns the agent's reply on success. */
export async function probeAgent(
  conn: AgentConnection,
): Promise<EngineResult<string>> {
  return sendToAgent(
    conn,
    [{ role: "user", content: "Hello — this is a connection test. Please reply briefly." }],
    "preflight-probe",
  );
}

function extractAssistantReply(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;

  // OpenAI chat completions shape
  if (Array.isArray(obj.choices)) {
    const first = obj.choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
  }

  // Coval-style shape: {messages: [{role, content}]}
  if (Array.isArray(obj.messages)) {
    const assistants = (obj.messages as WireMessage[]).filter(
      (m) => m.role === "assistant" && typeof m.content === "string",
    );
    const last = assistants[assistants.length - 1];
    if (last) return last.content;
  }

  // Bare {content: "..."} or {reply: "..."} — be forgiving at the edge
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.reply === "string") return obj.reply;

  return null;
}
