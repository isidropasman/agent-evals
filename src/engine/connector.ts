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

/** A tool call the agent is requesting, in OpenAI function-calling shape. */
export interface WireToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the agent produced it — not parsed here, since a
   * malformed-arguments call is itself a failure mode to observe, not hide. */
  arguments: string;
}

/**
 * Wire-level message, richer than the engine's `Turn` — carries the fields
 * needed to negotiate a tool-calling round-trip with the agent's endpoint
 * (an assistant message requesting calls, or a tool-role reply answering one).
 */
export interface WireMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  /** Set on an assistant message that is requesting tool calls. */
  toolCalls?: WireToolCall[];
  /** Set on a tool-role message — which call this is the result of. */
  toolCallId?: string;
}

export type AgentReply =
  | { kind: "message"; content: string }
  | { kind: "tool_calls"; content: string | null; calls: WireToolCall[] };

/**
 * Flattens engine-level `Turn[]` (which folds a whole tool round-trip into a
 * few `role: "tool"` entries — see Turn's doc comment) into wire messages for
 * an OUTGOING request. Past tool activity is presented as the assistant's own
 * narration rather than replayed as bare `tool` messages: a `tool`-role wire
 * message is only valid immediately after an assistant message that requested
 * that exact call, which we no longer have once a turn is complete and
 * flattened. This keeps every outgoing request protocol-valid on strict
 * OpenAI-shaped servers, at the cost of the agent seeing its past tool calls
 * as text instead of structured history — acceptable because agents that need
 * real cross-turn memory keep it server-side, keyed by the session id we
 * already send on every request.
 */
export function turnsToWire(turns: Turn[]): WireMessage[] {
  return turns.map((t) => ({
    role: t.role === "tool" ? "assistant" : t.role,
    content: t.content,
  }));
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

/**
 * Protocol-aware call: posts wire messages to the agent's endpoint and
 * returns either a final message or a request for tool calls. Shared by
 * `sendToAgent` (simple text-only callers) and `sendToAgentRaw` (the
 * tool-calling loop, which needs to see `tool_calls` to react to them).
 */
async function postToAgent(
  conn: AgentConnection,
  messages: WireMessage[],
  sessionId: string,
): Promise<EngineResult<AgentReply>> {
  const wireBody = messages.map((m) =>
    m.role === "assistant" && m.toolCalls
      ? {
          role: m.role,
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        }
      : m.role === "tool"
        ? { role: m.role, content: m.content, tool_call_id: m.toolCallId }
        : { role: m.role, content: m.content },
  );

  // `user` is OpenAI's standard end-user identifier field; carrying the
  // session id there means both protocols tell the agent which conversation
  // a request belongs to, which agents that keep state server-side need.
  const body =
    conn.protocol === "openai"
      ? JSON.stringify({ model: "agent", messages: wireBody, user: sessionId })
      : JSON.stringify({ sessionId, messages: wireBody });

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

  const reply = extractAgentReply(json);
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

/**
 * Protocol-aware send for the tool-calling loop: takes wire messages
 * directly (so live `toolCalls`/`toolCallId` fields survive) and surfaces a
 * `tool_calls` reply instead of flattening it, so the caller can negotiate
 * the round-trip (mock a result, send it back, repeat).
 */
export async function sendToAgentRaw(
  conn: AgentConnection,
  messages: WireMessage[],
  sessionId: string,
): Promise<EngineResult<AgentReply>> {
  return postToAgent(conn, messages, sessionId);
}

export async function sendToAgent(
  conn: AgentConnection,
  transcript: Turn[],
  sessionId: string,
): Promise<EngineResult<string>> {
  const result = await postToAgent(conn, turnsToWire(transcript), sessionId);
  if (!result.ok) return result;
  if (result.value.kind === "message") return { ok: true, value: result.value.content };
  // A tool-calls-only reply from a plain sendToAgent caller (probeAgent, task
  // mode without tool support) still counts as a live, protocol-speaking
  // agent — render it as text rather than treating it as a connector error.
  const rendered = renderToolCallsAsText(result.value);
  return { ok: true, value: rendered };
}

function renderToolCallsAsText(reply: Extract<AgentReply, { kind: "tool_calls" }>): string {
  const calls = reply.calls
    .map((c) => `🔧 ${c.name}(${c.arguments})`)
    .join("; ");
  return reply.content ? `${reply.content} ${calls}` : calls;
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

function parseWireToolCalls(raw: unknown): WireToolCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const calls: WireToolCall[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const fn = item.function as Record<string, unknown> | undefined;
    const id = item.id;
    const name = fn?.name;
    const args = fn?.arguments;
    if (typeof id !== "string" || typeof name !== "string" || typeof args !== "string") {
      continue; // malformed entry — skip rather than fail the whole reply
    }
    calls.push({ id, name, arguments: args });
  }
  return calls.length > 0 ? calls : null;
}

function extractAgentReply(json: unknown): AgentReply | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;

  // OpenAI chat completions shape — tool_calls takes priority over content
  // when both are present, since it's the actionable signal.
  if (Array.isArray(obj.choices)) {
    const first = obj.choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const toolCalls = parseWireToolCalls(message?.tool_calls);
    if (toolCalls) {
      return {
        kind: "tool_calls",
        content: typeof message?.content === "string" ? message.content : null,
        calls: toolCalls,
      };
    }
    if (typeof message?.content === "string") {
      return { kind: "message", content: message.content };
    }
  }

  // Coval-style shape: {messages: [{role, content}]}
  if (Array.isArray(obj.messages)) {
    const assistants = (obj.messages as WireMessage[]).filter(
      (m) => m.role === "assistant" && typeof m.content === "string",
    );
    const last = assistants[assistants.length - 1];
    if (last?.content) return { kind: "message", content: last.content };
  }

  // Bare {content: "..."} or {reply: "..."} — be forgiving at the edge
  if (typeof obj.content === "string") return { kind: "message", content: obj.content };
  if (typeof obj.reply === "string") return { kind: "message", content: obj.reply };

  return null;
}
