import { describe, expect, it } from "vitest";
import { normalizeTraceEnvelope, redactTracePayload } from "@/server/trace-normalizer";

describe("trace normalization", () => {
  it("redacts nested credentials and trims bounded fields", () => {
    const result = normalizeTraceEnvelope({ traceId: " trace-1 ", eventId: " event-1 ", agentId: " agent-1 ", kind: "turn", input: { nested: { apiKey: "secret", message: "hello" } }, occurredAt: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ traceId: "trace-1", input: { nested: { apiKey: "[REDACTED]", message: "hello" } } });
  });

  it("rejects payloads above the per-field limit", () => {
    const result = normalizeTraceEnvelope({ traceId: "trace-2", eventId: "event-2", agentId: "agent-1", kind: "turn", input: "x".repeat(70_000), occurredAt: 10 });
    expect(result).toEqual({ ok: false, error: "trace payload exceeds 64 KiB" });
  });

  it("redacts cookie and credential fields recursively", () => {
    const result = redactTracePayload({ headers: { cookie: "session=secret", credential: "value" } });
    expect(result).toEqual({ headers: { cookie: "[REDACTED]", credential: "[REDACTED]" } });
  });
});
